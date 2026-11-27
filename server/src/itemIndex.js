/**
 * Item definition index: scans the worktree's `.items` files and maps item
 * names to their definition location, for go-to-definition / references /
 * rename.
 *
 * `.items` definitions are line-oriented (`Type[:Sub…] Name "label" …`), so
 * the scanner is line-based rather than tree-sitter based — that keeps the
 * server bundle dependency-free (the grammar is only used by Zed itself).
 */
'use strict'

const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const { collectFiles } = require('./files')

/**
 * The grammar's `dsl_type_word` list (grammar/grammar.js): the 12 base item
 * types plus the extra `.items` types (`Call`, `StringList`, `QuantityType`)
 * and the sitemap widget words (`Default`, `Slider`, `Chart`, …) — one token
 * serves both dialects, so the definition-line matcher accepts all of them.
 * (`completion.js` offers only the 12 base item types to users.)
 */
const ITEM_TYPES = [
    'Color', 'Contact', 'DateTime', 'Dimmer', 'Group', 'Image', 'Location',
    'Number', 'Player', 'Rollershutter', 'String', 'Switch', 'Call',
    'StringList', 'QuantityType',
    'Default', 'Selection', 'Setpoint', 'Slider', 'Colorpicker',
    'Chart', 'Webview', 'Video', 'Mapview',
]

/** Directories never scanned for `.items` files live in files.js (SKIP_DIRS). */

/**
 * An item definition line looks like:
 *   Switch Kitchen_Light "Kitchen Light" <light> (gLights) { … }
 *   Group:Number:AVG gTemperature "…"
 *   Group:Contact:OR(OPEN, CLOSED) gWindowsensors "…"
 * The name is the first identifier after the type chain (type + `:…` segments,
 * where a segment may be `Unit`, `AVG`, or `OR(OPEN, CLOSED)`).
 */
const DEFINITION_RE = new RegExp(
    // The trailing `(?!\w|=)` keeps a sitemap widget line (`Switch item=X …`)
    // from matching: `item` must be a standalone name token, not a keyword
    // glued to `=X`.
    `^\\s*(?:${ITEM_TYPES.join('|')})(?::[A-Za-z_]\\w*(?:\\([^)]*\\))?)*\\s+([A-Za-z_]\\w*)(?!\\w|=)`,
)

/** Item name token: openHAB names are `[A-Za-z_][A-Za-z0-9_]*`. */
const NAME_RE = /^[A-Za-z_]\w*$/

/**
 * Parse one line of a `.items` file.
 *
 * @param {string} line
 * @param {number} lineNumber 0-based
 * @returns {{name: string, range: {start: {line: number, character: number}, end: {line: number, character: number}}} | null}
 */
function parseDefinitionLine(line, lineNumber) {
    // A definition never starts inside a comment; `//` before the type word
    // means the line is a comment.
    const match = DEFINITION_RE.exec(line)
    if (!match) {
        return null
    }
    const name = match[1]
    const start = match.index + match[0].indexOf(name)
    return {
        name,
        range: {
            start: { line: lineNumber, character: start },
            end: { line: lineNumber, character: start + name.length },
        },
    }
}

/**
 * Parse all definitions in a `.items` file's text.
 *
 * @param {string} text
 * @returns {Array<{name: string, range: object}>}
 */
function parseItemsFile(text) {
    const definitions = []
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
        // Skip comment lines (the regex would not match them anyway, since a
        // comment starts with `//`, but being explicit avoids surprises with
        // `// Switch X` lines).
        if (lines[i].trimStart().startsWith('//')) {
            continue
        }
        const def = parseDefinitionLine(lines[i], i)
        if (def) {
            definitions.push(def)
        }
    }
    return definitions
}

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
    }

    /** Rescan the whole worktree (synchronous). */
    scan() {
        this.definitions.clear()
        this.mtimes.clear()
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
        this.definitions.clear()
        this.mtimes.clear()
        const files = collectItemsFiles(this.rootDir)
        const BATCH = 16
        for (let i = 0; i < files.length; i += BATCH) {
            await Promise.all(files.slice(i, i + BATCH).map((file) => this.scanFileAsync(file)))
        }
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

    /** Replace this file's definitions in the index. */
    _store(file, stat, text) {
        // Drop previous definitions from this file.
        for (const [name, def] of this.definitions) {
            if (def.file === file) {
                this.definitions.delete(name)
            }
        }
        const uri = pathToFileURL(file).href
        for (const def of parseItemsFile(text)) {
            this.definitions.set(def.name, { ...def, uri, file, mtimeMs: stat.mtimeMs })
        }
        this.mtimes.set(file, stat.mtimeMs)
    }

    /** Refresh a single file (called from didChangeWatchedFiles). */
    refresh(file) {
        if (!file.endsWith('.items')) {
            return false
        }
        return this.scanFile(file)
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
}

module.exports = {
    ItemIndex,
    collectItemsFiles,
    parseDefinitionLine,
    parseItemsFile,
    NAME_RE,
    ITEM_TYPES,
}
