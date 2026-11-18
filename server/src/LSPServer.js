#!/usr/bin/env node
/**
 * Entry point for the openHAB language server, bundled by esbuild into
 * `server/openhab-language-server.js`.
 *
 * Adapted from the openHAB VS Code extension's LSPServer.js. The module shape is
 * kept (`module.exports = { server }`) so the upstream unit tests that `require`
 * this file keep working.
 *
 * @see https://github.com/openhab/openhab-vscode/blob/main/serverJS/src/LSPServer.js
 */
'use strict'

const Server = require('./Server')

const server = new Server()
server.start()

module.exports = {
    server,
}
