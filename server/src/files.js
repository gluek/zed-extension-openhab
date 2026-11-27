/**
 * LSP transport/file helpers shared by the server and its tests.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

/** Map a document URI or path to its lowercased openHAB file extension. */
function extensionOf(uri) {
    const match = /\.([A-Za-z]+)$/.exec(uri || '')
    return match ? match[1].toLowerCase() : ''
}

/** Extensions this server provides completion for. */
const OPENHAB_EXTENSIONS = ['items', 'rules', 'script', 'sitemap', 'things', 'persist']

/** Directories never scanned for openHAB config files. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.scratch', 'target'])

/**
 * Recursively collect files under `rootDir` whose name `accept` returns true
 * for, skipping junk directories. Returns absolute paths, sorted.
 *
 * @param {string} rootDir
 * @param {(fileName: string) => boolean} accept
 * @returns {string[]}
 */
function collectFiles(rootDir, accept) {
    const files = []
    const stack = [rootDir]
    while (stack.length) {
        const dir = stack.pop()
        let entries
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
            continue
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name)) {
                    stack.push(full)
                }
            } else if (entry.isFile() && accept(entry.name)) {
                files.push(full)
            }
        }
    }
    return files.sort()
}

/**
 * The text of the line at `position`, without splitting the whole document.
 * `source` may be a TextDocument (fast path: its cached line offsets make this
 * O(line length) instead of O(document)) or a plain string (full split).
 *
 * @param {string | {getText(): string, offsetAt(position: object): number, positionAt(offset: number): object}} source
 * @param {{line: number, character: number}} position
 * @returns {string}
 */
function lineAt(source, position) {
    const text = typeof source === 'string' ? source : source.getText()
    if (typeof source !== 'string' && typeof source.offsetAt === 'function') {
        // Round-trip through positionAt so an out-of-range line/character is
        // clamped before the line start is computed.
        const pos = source.positionAt(source.offsetAt(position))
        if (pos.line !== position.line) {
            return '' // past the end of the document
        }
        const offset = source.offsetAt(pos)
        const start = offset - pos.character
        let end = text.indexOf('\n', offset)
        if (end === -1) {
            end = text.length
        }
        const line = text.slice(start, end)
        return line.endsWith('\r') ? line.slice(0, -1) : line
    }
    return text.split(/\r?\n/)[position.line] || ''
}

module.exports = { extensionOf, OPENHAB_EXTENSIONS, SKIP_DIRS, collectFiles, lineAt }
