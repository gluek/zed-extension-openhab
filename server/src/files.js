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

module.exports = { extensionOf, OPENHAB_EXTENSIONS, SKIP_DIRS, collectFiles }
