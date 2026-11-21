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
 *  - Diagnostics for unknown item references (not the same as upstream's
 *    DocumentValidator stub, which is not ported). Zed pulls diagnostics from
 *    the server on open/change; see validateDocument().
 *
 * @see https://github.com/openhab/openhab-vscode/blob/main/serverJS/src/Server.js
 */
'use strict'

const {
    TextDocuments,
    createConnection,
    ProposedFeatures,
    DidChangeConfigurationNotification,
    DidChangeWatchedFilesNotification,
} = require('vscode-languageserver')
const { TextDocument } = require('vscode-languageserver-textdocument')
const { fileURLToPath } = require('node:url')

const ItemStore = require('./ItemStore')
const completion = require('./completion')
const hover = require('./hover')
const { extensionOf, OPENHAB_EXTENSIONS } = require('./files')
const { findUnknownItemRefs } = require('./diagnostics')
const { ItemIndex, NAME_RE } = require('./itemIndex')
const { findReferencesInWorktree } = require('./references')
const { ThingTypeStore } = require('./thingTypes')
const { ThingStore } = require('./things')

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
        this.thingTypes = new ThingTypeStore({ log: (message) => this.log(message) })
        this.things = new ThingStore({ log: (message) => this.log(message) })

        this.connection.onInitialize(this.initialize.bind(this))
        this.connection.onInitialized(this.initialized.bind(this))
        this.connection.onExit(this.exit.bind(this))
        this.connection.onDidChangeConfiguration(this.configurationChanged.bind(this))
        this.connection.onCompletion(this.getCompletion.bind(this))
        this.connection.onHover(this.getHover.bind(this))
        this.connection.onDefinition(this.getDefinition.bind(this))
        this.connection.onReferences(this.getReferences.bind(this))
        this.connection.onPrepareRename(this.prepareRename.bind(this))
        this.connection.onRenameRequest(this.rename.bind(this))

        this.documents = new TextDocuments(TextDocument)
        this.documents.listen(this.connection)

        // Unknown-item diagnostics, pushed on open/change and cleared on close.
        this.documents.onDidOpen((event) => this.validateDocument(event.document))
        this.documents.onDidChangeContent((event) => this.validateDocument(event.document))
        this.documents.onDidClose((event) => {
            this.connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] })
        })

        // Item definitions in the worktree's .items files (go-to-definition /
        // references / rename). Root comes from initialize params; scanned
        // lazily on first use and refreshed on watched-file events.
        this.index = null
        this.connection.onDidChangeWatchedFiles((params) => {
            if (!this.index) {
                return
            }
            for (const change of params.changes) {
                if (change.uri.endsWith('.items')) {
                    this.index.refresh(fileURLToPath(change.uri))
                }
            }
        })

        this.connection.listen()
    }

    /** Absolute worktree root from the initialize params, if any. */
    get rootDir() {
        const folders = this.initializeParams?.workspaceFolders
        if (folders && folders.length && folders[0].uri) {
            try {
                return fileURLToPath(folders[0].uri)
            } catch {
                /* fall through */
            }
        }
        const rootUri = this.initializeParams?.rootUri
        if (rootUri) {
            try {
                return fileURLToPath(rootUri)
            } catch {
                /* fall through */
            }
        }
        return null
    }

    /** Lazily create and scan the definition index. */
    getIndex() {
        if (!this.index) {
            const rootDir = this.rootDir
            if (!rootDir) {
                return null
            }
            this.index = new ItemIndex({ rootDir })
            this.index.scan()
            this.log(`indexed ${this.index.size} item definitions under ${rootDir}`)
        }
        return this.index
    }

    /**
     * Status messages go to the client as LSP log messages, which Zed shows in
     * its log view. Console output from a stdio child process would be lost.
     */
    log(message) {
        this.connection?.console?.info(`[openhab-lsp] ${message}`)
    }

    initialize(params) {
        this.initializeParams = params
        this.settings = resolveSettings(params.initializationOptions)
        return {
            capabilities: {
                textDocumentSync: this.documents.syncKind,
                completionProvider: {
                    resolveProvider: false,
                    triggerCharacters: ['=', '(', ',', '[', '<'],
                },
                hoverProvider: true,
                definitionProvider: true,
                referencesProvider: true,
                renameProvider: { prepareProvider: true },
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
        await this.thingTypes.load(this.settings)
        await this.things.start(this.settings)
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
            await this.thingTypes.load(this.settings)
            this.things.stop()
            await this.things.start(this.settings)
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
        // `.items`: channel="…" value completion.
        if (completion.isChannelValuePosition(extension, context)) {
            const partial = /\bchannel\s*=\s*"([^"]*)$/.exec(context.before)[1]
            return {
                isIncomplete: false,
                items: completion.channelCompletions(partial, this.things.allChannels),
            }
        }
        // `.things`: thing-type UID completion after `Thing `/`Bridge `.
        if (completion.isThingUidPosition(extension, context)) {
            const partial = /^\s*(?:Thing|Bridge)\s+([A-Za-z0-9_:\-]*)$/.exec(context.before)[1]
            return {
                isIncomplete: false,
                items: completion.thingUidCompletions(partial, this.thingTypes.bindingIds, (b) =>
                    this.thingTypes.uidsForBinding(b),
                ),
            }
        }
        if (!completion.offersItems(extension, context)) {
            return { isIncomplete: false, items: [] }
        }
        return { isIncomplete: false, items: completion.itemCompletions(this.store.all) }
    }

    /** Hover: live state of the item under the cursor, when it is a known item. */
    getHover(params) {
        const document = this.documents.get(params.textDocument.uri)
        if (!document) {
            this.log(`hover: document not found: ${params.textDocument.uri}`)
            return null
        }
        const text = document.getText()
        const word = hover.wordAt(text, params.position)
        if (!word) {
            return null
        }
        const item = this.store.items.get(word)
        if (!item) {
            this.log(`hover: "${word}" at ${params.position.line}:${params.position.character} is not a known item (${this.store.size} cached)`)
            return null
        }
        return hover.hoverFor(item)
    }

    /**
     * Go-to-definition: the `.items` line that defines the item under the
     * cursor. If the cursor is already on a definition, returns it (self).
     * Items that exist only on the openHAB instance (no local definition)
     * return null — there is no file to jump to.
     */
    getDefinition(params) {
        const document = this.documents.get(params.textDocument.uri)
        if (!document) {
            return null
        }
        const word = hover.wordAt(document.getText(), params.position)
        if (!word) {
            return null
        }
        const index = this.getIndex()
        const def = index && index.get(word)
        if (!def) {
            return null
        }
        return { uri: def.uri, range: def.range }
    }

    /**
     * References: every usage of the item under the cursor across the
     * worktree's openHAB files. `includeDeclaration` adds the definition.
     */
    getReferences(params) {
        const document = this.documents.get(params.textDocument.uri)
        if (!document) {
            return []
        }
        const word = hover.wordAt(document.getText(), params.position)
        if (!word) {
            return []
        }
        const rootDir = this.rootDir
        if (!rootDir) {
            return []
        }
        // Include any open documents even if outside the scanned root.
        const extraFiles = [...this.documents.all()].map((d) => {
            try {
                return fileURLToPath(d.uri)
            } catch {
                return null
            }
        }).filter(Boolean)
        const locations = findReferencesInWorktree(rootDir, word, { extraFiles })
        if (params.context?.includeDeclaration) {
            const index = this.getIndex()
            const def = index && index.get(word)
            if (def) {
                locations.push({ uri: def.uri, range: def.range })
            }
        }
        return locations
    }

    /**
     * Prepare-rename: only allow renaming when the word under the cursor is a
     * known item (locally defined or present on the openHAB instance).
     * Returns the word's range, or null to reject the rename.
     */
    prepareRename(params) {
        const document = this.documents.get(params.textDocument.uri)
        if (!document) {
            return null
        }
        const word = hover.wordAt(document.getText(), params.position)
        if (!word || !NAME_RE.test(word)) {
            return null
        }
        const index = this.getIndex()
        const known = (index && index.has(word)) || this.store.items.has(word)
        if (!known) {
            return null
        }
        // Compute the word's range from the cursor position.
        const line = document.getText().split(/\r?\n/)[params.position.line] || ''
        const col = Math.min(params.position.character, line.length)
        let start = col
        while (start > 0 && hover.WORD_CHAR_TEST(line[start - 1])) {
            start -= 1
        }
        let end = col
        while (end < line.length && hover.WORD_CHAR_TEST(line[end])) {
            end += 1
        }
        return {
            range: {
                start: { line: params.position.line, character: start },
                end: { line: params.position.line, character: end },
            },
            placeholder: word,
        }
    }

    /**
     * Rename: rewrite every reference (and the definition) of the item to the
     * new name, as a WorkspaceEdit grouped by file. Workspace-text only — the
     * running openHAB instance is not renamed (that would need a REST call
     * and is a deliberate non-goal for now).
     */
    rename(params) {
        const document = this.documents.get(params.textDocument.uri)
        if (!document) {
            return null
        }
        const word = hover.wordAt(document.getText(), params.position)
        const newName = params.newName
        if (!word || !NAME_RE.test(newName)) {
            return null
        }
        const rootDir = this.rootDir
        if (!rootDir) {
            return null
        }
        const extraFiles = [...this.documents.all()].map((d) => {
            try {
                return fileURLToPath(d.uri)
            } catch {
                return null
            }
        }).filter(Boolean)
        const locations = findReferencesInWorktree(rootDir, word, { extraFiles })
        const index = this.getIndex()
        const def = index && index.get(word)
        if (def) {
            locations.push({ uri: def.uri, range: def.range })
        }
        /** @type {Record<string, Array<{range: object, newText: string}>>} */
        const changes = {}
        for (const loc of locations) {
            ;(changes[loc.uri] = changes[loc.uri] || []).push({
                range: loc.range,
                newText: newName,
            })
        }
        return { changes }
    }

    /**
     * An item is "known" when it is defined in the worktree's .items files or
     * present on the running openHAB instance (live cache).
     */
    isKnownItem(name) {
        const index = this.getIndex()
        return (index && index.has(name)) || this.store.items.has(name)
    }

    /**
     * Publish diagnostics for unknown item references in an open document.
     * Runs on didOpen/didChange; cleared on didClose.
     */
    validateDocument(document) {
        if (!document) {
            return
        }
        const extension = extensionOf(document.uri)
        if (!OPENHAB_EXTENSIONS.includes(extension)) {
            return
        }
        const found = findUnknownItemRefs(document.getText(), extension, (name) => this.isKnownItem(name))
        this.connection.sendDiagnostics({
            uri: document.uri,
            diagnostics: found.map((d) => ({
                range: d.range,
                severity: 2, // Warning
                source: 'openhab-lsp',
                message: d.message,
            })),
        })
    }

    exit() {
        this.store.stop()
        this.things.stop()
    }
}

module.exports = Server
