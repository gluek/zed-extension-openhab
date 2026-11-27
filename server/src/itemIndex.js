/**
 * Item definition + semantic-tag index: scans the worktree's `.items` files
 * and maps item names to their definition location, for go-to-definition /
 * references / rename. The same pass also collects the `["…"]` tag values
 * per file — one read feeds both indexes (the tag scan used to re-read every
 * file separately) — and per-file reverse indexes (`namesByFile`,
 * `tagsByFile`) make rescanning one file O(that file) instead of O(total).
 *
 * `.items` definitions are line-oriented (`Type[:Sub…] Name "label" …`), so
 * the scanner is line-based rather than tree-sitter based — that keeps the
 * server bundle dependency-free (the grammar is only used by Zed itself).
 */
'use strict'

const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const { collectFiles } = require('./files')
const { parseItemsFile, parseDefinitionLine, NAME_RE, ITEM_TYPES, tagListValues } = require('./itemParse')

/** Directories never scanned for `.items` files live in files.js (SKIP_DIRS). */

/** Recursively collect `.items` files under `rootDir`, skipping junk dirs. */
function collectItemsFiles(rootDir) {
    return collectFiles(rootDir, (name) => name.endsWith('.items'))
}

/**
 * The definition index over a worktree.
 */
class ItemIndex {
    /**
     * @param {{rootDir: string}} options
     */
    constructor({ rootDir }) {
        this.rootDir = rootDir
        /** @type {Map<string, {uri: string, range: object, file: string, mtimeMs: number}>} */
        this.definitions = new Map()
        /** @type {Map<string, number>} file path -> mtimeMs at scan time */
        this.mtimes = new Map()
        /** @type {Map<string, Set<string>>} file -> item names defined in it */
        this.namesByFile = new Map()
        /** @type {Map<string, Array<{file: string, line: number}>>} tag -> usage lines */
        this.tagUsages = new Map()
        /** @type {Map<string, Set<string>>} file -> tags used in it */
        this.tagsByFile = new Map()
    }

    /** Rescan the whole worktree (synchronous). */
    scan() {
        this._clear()
        for (const file of collectItemsFiles(this.rootDir)) {
            this.scanFile(file)
        }
    }

    /**
     * Async variant of `scan()`: reads the files in bounded batches, so the
     * initial index build does not block the event loop with readFileSync and
     * does not fire hundreds of concurrent reads on a large worktree.
     */
    async scanAsync() {
        this._clear()
        const files = collectItemsFiles(this.rootDir)
        const BATCH = 16
        for (let i = 0; i < files.length; i += BATCH) {
            await Promise.all(files.slice(i, i + BATCH).map((file) => this.scanFileAsync(file)))
        }
    }

    _clear() {
        this.definitions.clear()
        this.mtimes.clear()
        this.namesByFile.clear()
        this.tagUsages.clear()
        this.tagsByFile.clear()
    }

    /**
     * (Re)scan a single file if its mtime changed since the last scan.
     *
     * @param {string} file absolute path
     * @returns {boolean} true if the file was (re)scanned
     */
    scanFile(file) {
        let stat
        try {
            stat = fs.statSync(file)
        } catch {
            return false
        }
        if (this._unchanged(file, stat)) {
            return false
        }
        let text
        try {
            text = fs.readFileSync(file, 'utf8')
        } catch {
            return false
        }
        this._store(file, stat, text)
        return true
    }

    /** Async single-file variant of `scanFile`. */
    async scanFileAsync(file) {
        let stat
        try {
            stat = await fs.promises.stat(file)
        } catch {
            return false
        }
        if (this._unchanged(file, stat)) {
            return false
        }
        let text
        try {
            text = await fs.promises.readFile(file, 'utf8')
        } catch {
            return false
        }
        this._store(file, stat, text)
        return true
    }

    /**
     * mtime check shared by the sync and async scanners. Compare with 2 ms
     * tolerance: filesystem mtime granularity varies (ext4 has ns, some
     * mounts only s), and a write+utimes round-trip can shift the value by a
     * fraction of a millisecond.
     */
    _unchanged(file, stat) {
        const previous = this.mtimes.get(file)
        return previous !== undefined && Math.abs(previous - stat.mtimeMs) < 2
    }

    /** Replace this file's definitions and tags in the index. */
    _store(file, stat, text) {
        // Drop previous definitions and tags from this file (O(entries of
        // this file), via the per-file reverse indexes).
        this._dropFile(file)
        const uri = pathToFileURL(file).href
        const names = new Set()
        for (const def of parseItemsFile(text)) {
            names.add(def.name)
            this.definitions.set(def.name, { ...def, uri, file, mtimeMs: stat.mtimeMs })
        }
        this.namesByFile.set(file, names)
        const tags = new Set()
        const lines = text.split(/\r?\n/)
        for (let lineNo = 0; lineNo < lines.length; lineNo++) {
            // Shared tag-list extraction (also used by diagnostics.js):
            // a […] after the label string, without '=' inside (Location
            // config excluded).
            for (const { tag } of tagListValues(lines[lineNo])) {
                tags.add(tag)
                const usages = this.tagUsages.get(tag)
                if (usages) {
                    usages.push({ file, line: lineNo })
                } else {
                    this.tagUsages.set(tag, [{ file, line: lineNo }])
                }
            }
        }
        this.tagsByFile.set(file, tags)
        this.mtimes.set(file, stat.mtimeMs)
    }

    /** Forget every index entry that came from `file` (deleted or rescanned). */
    _dropFile(file) {
        const names = this.namesByFile.get(file)
        if (names) {
            for (const name of names) {
                this.definitions.delete(name)
            }
            this.namesByFile.delete(file)
        }
        const tags = this.tagsByFile.get(file)
        if (tags) {
            for (const tag of tags) {
                const usages = this.tagUsages.get(tag)
                if (!usages) {
                    continue
                }
                const kept = usages.filter((u) => u.file !== file)
                if (kept.length) {
                    this.tagUsages.set(tag, kept)
                } else {
                    this.tagUsages.delete(tag)
                }
            }
            this.tagsByFile.delete(file)
        }
        this.mtimes.delete(file)
    }

    /** Refresh a single file (called from didChangeWatchedFiles). */
    refresh(file) {
        if (!file.endsWith('.items')) {
            return false
        }
        return this.scanFile(file)
    }

    /** Forget a file deleted from disk: definitions and tags. */
    removeFile(file) {
        this._dropFile(file)
    }

    /**
     * Ensure the index is fresh for a file that may have changed on disk,
     * then look up a definition.
     *
     * @param {string} name
     */
    get(name) {
        return this.definitions.get(name) || null
    }

    has(name) {
        return this.definitions.has(name)
    }

    get size() {
        return this.definitions.size
    }

    /**
     * Tags used anywhere in the worktree's `.items` files (offered before the
     * built-in ontology list so project-local tags complete first).
     */
    get usedTags() {
        return new Set(this.tagUsages.keys())
    }
}

module.exports = {
    ItemIndex,
    collectItemsFiles,
    parseDefinitionLine,
    parseItemsFile,
    NAME_RE,
    ITEM_TYPES,
}
