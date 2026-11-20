/**
 * openHAB language server for Zed.
 *
 * Adapted from the openHAB VS Code extension's Server.js. Differences that
 * matter for running under Zed:
 *
 *  - Settings come from `initializationOptions` first, then
 *    `workspace/configuration`. VS Code pushes settings through
 *    `workspace/configuration` only after `initialized`, and Zed supplies the
 *    same object both ways; reading `initializationOptions` means completions
 *    work even if the client never answers the configuration request.
 *  - Connection failures are logged to the client instead of being swallowed by
 *    a VS Code output channel that Zed cannot show.
 *  - No diagnostics. The upstream DocumentValidator is a stub returning an empty
 *    array, so it is not ported; advertising a provider that never reports
 *    anything is worse than not advertising one.
 *
 * @see https://github.com/openhab/openhab-vscode/blob/main/serverJS/src/Server.js
 */
'use strict'

const {
    TextDocuments,
    createConnection,
    ProposedFeatures,
    DidChangeConfigurationNotification,
} = require('vscode-languageserver')
const { TextDocument } = require('vscode-languageserver-textdocument')

const ItemStore = require('./ItemStore')
const completion = require('./completion')
const { extensionOf } = require('./files')

const DEFAULT_SETTINGS = {
    host: 'localhost',
    port: 8080,
    authToken: null,
    basicAuth: null,
    lspEnabled: true,
}

/** Settings that require reconnecting to openHAB when they change. */
const CONNECTION_KEYS = ['host', 'port', 'authToken', 'basicAuth']

/**
 * Merge user settings over the defaults.
 *
 * `authToken` and `basicAuth` are intentionally allowed to be explicitly null:
 * that is how a user clears a credential that was previously set.
 */
function resolveSettings(raw) {
    const merged = { ...DEFAULT_SETTINGS }
    for (const [key, value] of Object.entries(raw || {})) {
        if (value !== undefined) {
            merged[key] = value
        }
    }
    return merged
}

class Server {
    start() {
        // vscode-languageserver's `createConnection()` inspects `process.argv`
        // for a transport flag; when none is present it throws. Zed passes
        // `--stdio` on the command line, so pass the streams explicitly.
        this.connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout)

        this.settings = { ...DEFAULT_SETTINGS }
        this.store = new ItemStore({ log: (message) => this.log(message) })

        this.connection.onInitialize(this.initialize.bind(this))
        this.connection.onInitialized(this.initialized.bind(this))
        this.connection.onExit(this.exit.bind(this))
        this.connection.onDidChangeConfiguration(this.configurationChanged.bind(this))
        this.connection.onCompletion(this.getCompletion.bind(this))

        this.documents = new TextDocuments(TextDocument)
        this.documents.listen(this.connection)

        this.connection.listen()
    }

    /**
     * Status messages go to the client as LSP log messages, which Zed shows in
     * its log view. Console output from a stdio child process would be lost.
     */
    log(message) {
        this.connection?.console?.info(`[openhab-lsp] ${message}`)
    }

    initialize(params) {
        this.settings = resolveSettings(params.initializationOptions)
        return {
            capabilities: {
                textDocumentSync: this.documents.syncKind,
                completionProvider: {
                    resolveProvider: false,
                    triggerCharacters: ['=', '(', ',', '[', '<'],
                },
            },
            serverInfo: { name: 'openHAB Language Server', version: '0.1.0' },
        }
    }

    async initialized() {
        // `workspace/configuration` wins when the client supports it, because it
        // reflects settings changed after the server started.
        const configured = await this.readClientConfiguration()
        if (configured) {
            this.settings = resolveSettings(configured)
        }

        if (!this.settings.lspEnabled) {
            this.log('disabled by configuration (lspEnabled = false)')
            return
        }
        this.connection.client.register(DidChangeConfigurationNotification.type, {
            section: 'openhab',
        })
        await this.store.restart(this.settings)
    }

    /**
     * Ask the client for the `openhab` section. Returns `undefined` when the
     * client cannot answer, so the caller keeps initializationOptions.
     */
    async readClientConfiguration() {
        const capabilities = this.connection.client.capabilities || {}
        if (!capabilities.workspace?.configuration) {
            return undefined
        }
        try {
            const result = await this.connection.workspace.getConfiguration({ section: 'openhab' })
            return result && typeof result === 'object' && Object.keys(result).length ? result : undefined
        } catch {
            return undefined
        }
    }

    async configurationChanged(change) {
        // VS Code pushes `{ openhab: {...} }`; Zed may push the section alone.
        const next = change?.settings?.openhab ?? change?.settings
        if (!next || typeof next !== 'object') {
            return
        }
        const previous = this.settings
        this.settings = resolveSettings(next)

        if (!this.settings.lspEnabled) {
            this.store.stop()
            return
        }
        const reconnected = CONNECTION_KEYS.some(
            (key) => JSON.stringify(previous[key]) !== JSON.stringify(this.settings[key]),
        )
        if (reconnected) {
            await this.store.restart(this.settings)
        }
    }

    /** Completion scoped to the positions where openHAB accepts item names. */
    getCompletion(params) {
        const document = this.documents.get(params.textDocument.uri)
        if (!document) {
            return { isIncomplete: false, items: [] }
        }
        const extension = extensionOf(params.textDocument.uri)
        const context = completion.contextAt(document.getText(), params.position)

        if (completion.isItemTypePosition(extension, context)) {
            return { isIncomplete: false, items: completion.typeCompletions() }
        }
        if (!completion.offersItems(extension, context)) {
            return { isIncomplete: false, items: [] }
        }
        return { isIncomplete: false, items: completion.itemCompletions(this.store.all) }
    }

    exit() {
        this.store.stop()
    }
}

module.exports = Server
