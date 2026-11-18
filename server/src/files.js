/**
 * LSP transport/file helpers shared by the server and its tests.
 */
'use strict'

/** Map a document URI or path to its lowercased openHAB file extension. */
function extensionOf(uri) {
    const match = /\.([A-Za-z]+)$/.exec(uri || '')
    return match ? match[1].toLowerCase() : ''
}

/** Extensions this server provides completion for. */
const OPENHAB_EXTENSIONS = ['items', 'rules', 'script', 'sitemap', 'things', 'persist']

module.exports = { extensionOf, OPENHAB_EXTENSIONS }
