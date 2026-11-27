/**
 * Reference finding for item names across openHAB config files.
 *
 * References are found textually: every word-boundary occurrence of the item
 * name, minus the places where the name is *not* a reference:
 *
 *  - inside string literals and comments (line and block),
 *  - the name token of an `item_definition` in a `.items` file (that is the
 *    definition, reported separately by the ItemIndex),
 *  - a local variable declaration in a rule (`val X = …`, `var X = …`),
 *  - a persist wildcard pattern (`gTemperature*`, `*` — the `*` means "this
 *    prefix", not the exact item).
 *
 * The word characters match the language config (`word_characters = ["_", "$"]`
 * plus alphanumerics), so `Kitchen_Light2` does not match a search for
 * `Kitchen_Light`.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const { parseDefinitionLine } = require('./itemParse')
const { collectFiles } = require('./files')

/** File extensions that can reference items. */
const SOURCE_EXTENSIONS = ['.items', '.rules', '.script', '.sitemap', '.persist']

/** Characters that make up an item name at the cursor (matches languages/openhab/config.toml). */
const WORD_CHAR = /[A-Za-z0-9_$]/

/**
 * Strip string literals and line comments from a line, preserving character
 * positions by replacing stripped characters with spaces. `inBlockComment` is
 * the state entering the line; the state leaving the line is returned via the
 * second element of the returned tuple.
 *
 * @param {string} line
 * @param {boolean} inBlockComment
 * @returns {[string, boolean]} [masked line, inBlockComment after the line]
 */
function maskStringsAndComments(line, inBlockComment) {
    let out = ''
    let i = 0
    let inBlock = inBlockComment
    while (i < line.length) {
        const ch = line[i]
        const next = line[i + 1]
        if (inBlock) {
            if (ch === '*' && next === '/') {
                out += '  '
                i += 2
                inBlock = false
            } else {
                out += ' '
                i += 1
            }
            continue
        }
        if (ch === '/' && next === '/') {
            // Line comment: mask the rest of the line.
            out += ' '.repeat(line.length - i)
            i = line.length
            continue
        }
        if (ch === '/' && next === '*') {
            out += '  '
            i += 2
            inBlock = true
            continue
        }
        if (ch === '"' || ch === "'") {
            // String literal: mask until the matching quote (no escapes in
            // openHAB DSL strings other than \" — handle the common case).
            const quote = ch
            out += ' '
            i += 1
            while (i < line.length && line[i] !== quote) {
                if (line[i] === '\\' && i + 1 < line.length) {
                    out += '  '
                    i += 2
                } else {
                    out += ' '
                    i += 1
                }
            }
            if (i < line.length) {
                out += ' '
                i += 1
            }
            continue
        }
        out += ch
        i += 1
    }
    return [out, inBlock]
}

/** Local variable declaration in a rule body: `val X = …` / `var X = …`. */
const LOCAL_DECL_RE = /\b(?:val|var)\s+[A-Za-z_]\w*\s*=/

/**
 * All reference ranges of `name` in `text`.
 *
 * @param {string} text full document text
 * @param {string} name item name
 * @param {{extension: string}} options file extension without the dot
 * @returns {Array<{range: {start: {line: number, character: number}, end: {line: number, character: number}}}>}
 */
function findReferencesInText(text, name, { extension }) {
    const references = []
    if (!name) {
        return references
    }
    const lines = text.split(/\r?\n/)
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Word boundary: the char before/after must not be a word char. openHAB
    // names contain `_` and `$`, so \b alone is wrong (it treats `_` as a
    // word char but not `$`).
    const occurrence = new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`, 'g')

    // Definition ranges to exclude (the name token of item_definition lines).
    const definitionRanges = new Set()
    if (extension === 'items') {
        for (let i = 0; i < lines.length; i++) {
            const def = parseDefinitionLine(lines[i], i)
            if (def && def.name === name) {
                definitionRanges.add(`${def.range.start.line}:${def.range.start.character}`)
            }
        }
    }

    let inBlockComment = false
    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
        const raw = lines[lineNo]
        const [masked, nextInBlock] = maskStringsAndComments(raw, inBlockComment)
        inBlockComment = nextInBlock

        occurrence.lastIndex = 0
        let match
        while ((match = occurrence.exec(masked)) !== null) {
            const character = match.index
            const key = `${lineNo}:${character}`
            if (definitionRanges.has(key)) {
                continue
            }
            // Local variable declaration: `val X = …` / `var X = …` on the
            // same line. The name is part of the declaration when the masked
            // line up to and including the match is `… val|var <name>` — the
            // name is the LAST token, so test the line up to the match END.
            // (`masked` is a single line — it contains no '\n' — so the
            // prefix always starts at 0.)
            const lineUpToEnd = masked.slice(0, character + name.length)
            const decl = /(?:^|[^A-Za-z0-9_$])(?:val|var)\s+([A-Za-z_]\w*)$/.exec(lineUpToEnd)
            if (decl && decl[1] === name) {
                continue
            }
            // Persist wildcard: `Name*` (the `*` is not a word char, so the
            // occurrence regex already matched the name; exclude if a `*`
            // immediately follows).
            if (masked[character + name.length] === '*') {
                continue
            }
            references.push({
                range: {
                    start: { line: lineNo, character },
                    end: { line: lineNo, character: character + name.length },
                },
            })
        }
    }
    return references
}

/**
 * All reference locations of `name` in a file.
 *
 * @param {string} file absolute path
 * @param {string} name item name
 * @returns {Array<{uri: string, range: object}>}
 */
function findReferencesInFile(file, name) {
    let text
    try {
        text = fs.readFileSync(file, 'utf8')
    } catch {
        return []
    }
    const extension = path.extname(file).slice(1)
    return findReferencesInText(text, name, { extension }).map((ref) => ({
        uri: pathToFileURL(file).href,
        range: ref.range,
    }))
}

/** Recursively collect openHAB source files under `rootDir` (sorted). */
function collectSourceFiles(rootDir) {
    return collectFiles(rootDir, (name) => SOURCE_EXTENSIONS.includes(path.extname(name)))
}

/**
 * All reference locations of `name` across every openHAB file in the worktree.
 *
 * @param {string} rootDir worktree root
 * @param {string} name item name
 * @param {{extraFiles?: string[]}} [options] open-but-unsaved or extra files to include
 */
function findReferencesInWorktree(rootDir, name, { extraFiles = [] } = {}) {
    const locations = []
    const seen = new Set()
    for (const file of [...collectSourceFiles(rootDir), ...extraFiles]) {
        if (seen.has(file)) {
            continue
        }
        seen.add(file)
        locations.push(...findReferencesInFile(file, name))
    }
    return locations
}

/**
 * Cached text of the worktree's openHAB source files, for reference finding
 * and rename.
 *
 * The uncached `findReferencesInWorktree` walks the worktree and reads every
 * file synchronously on each request, blocking the LSP event loop; this index
 * applies the `ItemIndex` pattern instead: one async, batched scan reads each
 * file once, requests then search the cached texts, and watched-file events
 * refresh (or drop) single files by mtime. Files not in the cache — open
 * documents outside the scanned root — are still read fresh per request.
 */
class ReferenceIndex {
    /**
     * @param {{rootDir: string}} options
     */
    constructor({ rootDir }) {
        this.rootDir = rootDir
        /** @type {Map<string, {mtimeMs: number, text: string}>} file -> cached text */
        this.files = new Map()
    }

    /** All reference locations of `name` across the cached files (plus `extraFiles`, read fresh). */
    findReferences(name, { extraFiles = [] } = {}) {
        const locations = []
        const seen = new Set()
        // Cache keys are in scan order (sorted), so the result order matches
        // the uncached `findReferencesInWorktree`.
        for (const file of [...this.files.keys(), ...extraFiles]) {
            if (seen.has(file)) {
                continue
            }
            seen.add(file)
            const cached = this.files.get(file)
            if (cached) {
                const extension = path.extname(file).slice(1)
                for (const ref of findReferencesInText(cached.text, name, { extension })) {
                    locations.push({ uri: pathToFileURL(file).href, range: ref.range })
                }
            } else {
                locations.push(...findReferencesInFile(file, name))
            }
        }
        return locations
    }

    /** (Re)scan the whole worktree asynchronously, in bounded batches. */
    async scanAsync() {
        this.files.clear()
        const files = collectSourceFiles(this.rootDir)
        const BATCH = 16
        for (let i = 0; i < files.length; i += BATCH) {
            await Promise.all(files.slice(i, i + BATCH).map((file) => this.scanFileAsync(file)))
        }
        return this.files.size
    }

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
        this.files.set(file, { mtimeMs: stat.mtimeMs, text })
        return true
    }

    /** Sync single-file (re)scan — watched-file events and tests. */
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
        this.files.set(file, { mtimeMs: stat.mtimeMs, text })
        return true
    }

    /** Refresh one file if it is a source file and its mtime changed. */
    refresh(file) {
        if (!SOURCE_EXTENSIONS.includes(path.extname(file))) {
            return false
        }
        return this.scanFile(file)
    }

    /** Forget a file deleted from disk. */
    removeFile(file) {
        return this.files.delete(file)
    }

    /** mtime check, same 2 ms tolerance as `ItemIndex`. */
    _unchanged(file, stat) {
        const previous = this.files.get(file)
        return previous !== undefined && Math.abs(previous.mtimeMs - stat.mtimeMs) < 2
    }

    get size() {
        return this.files.size
    }
}

module.exports = {
    SOURCE_EXTENSIONS,
    WORD_CHAR,
    ReferenceIndex,
    collectSourceFiles,
    findReferencesInFile,
    findReferencesInText,
    findReferencesInWorktree,
    maskStringsAndComments,
}
