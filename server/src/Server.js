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
    FileChangeType,
    SemanticTokensBuilder,
    SemanticTokensRequest,
    SemanticTokenTypes,
} = require('vscode-languageserver')
const { TextDocument } = require('vscode-languageserver-textdocument')
const { fileURLToPath } = require('node:url')

const ItemStore = require('./ItemStore')
const completion = require('./completion')
const hover = require('./hover')
const { extensionOf, OPENHAB_EXTENSIONS } = require('./files')
const icons = require('./icons')
const semantictags = require('./semantictags')
const { codeActionsAt } = require('./codeActions')
const { findUnknownChannels, findUnknownItemRefs, findUnknownTags } = require('./diagnostics')
const { findItemOccurrences } = require('./itemOccurrences')
const { ItemIndex, NAME_RE } = require('./itemIndex')
const { ReferenceIndex } = require('./references')
const { ThingTypeStore } = require('./thingTypes')
const { ThingStore } = require('./things')
const { debounce } = require('./rest')

const DEFAULT_SETTINGS = {
    host: 'localhost',
    port: 8080,
    authToken: null,
    basicAuth: null,
    lspEnabled: true,
}

/** Settings that require reconnecting to openHAB when they change. */
const CONNECTION_KEYS = ['host', 'port', 'authToken', 'basicAuth']

/** Trailing debounce for client refresh requests after item events, in ms. */
const REFRESH_DEBOUNCE_MS = 200

/** Trailing debounce for document validation after didChangeContent, in ms. */
const VALIDATION_DEBOUNCE_MS = 200

/**
 * Semantic-token legend: item references are `variable` (index 0), item
 * definitions are `property` + the `declaration` modifier (type 1, mod bit 0).
 * Zed maps these onto its own highlight scopes, so item names stand out from
 * rule-local variables and DSL keywords.
 */
const SEMANTIC_TOKEN_LEGEND = {
    tokenTypes: [SemanticTokenTypes.variable, SemanticTokenTypes.property],
    tokenModifiers: ['declaration'],
}
const TOKEN_ITEM_REF = 0
const TOKEN_ITEM_DEF = 1
const MOD_DECLARATION = 1 // 1 << 0

/**
 * Merge user settings over the defaults. The server owns the defaults
 * (single source of truth — the extension passes user settings through
 * unchanged, see `user_settings` in src/openhab.rs).
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
        // Item events arrive in bursts (one per changed item); without the
        // debounce a burst of N updates would send up to 2N refresh requests.
        this.clientRefresh = debounce(() => this.sendClientRefresh(), REFRESH_DEBOUNCE_MS)
        this.validators = new Map()
        this.store = new ItemStore({
            log: (message) => this.log(message),
            // Live state changes arrive over the event stream; ask the client
            // to re-pull inlay hints (and semantic tokens) so they stay live.
            onEvent: () => this.clientRefresh(),
        })
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
        this.connection.onRequest(SemanticTokensRequest.method, this.getSemanticTokens.bind(this))
        // vscode-languageserver 7.0 has no inlay-hint feature (the protocol lib
        // predates LSP 3.17), so register the request by method string.
        this.connection.onRequest('textDocument/inlayHint', this.getInlayHints.bind(this))
        this.connection.onCodeAction(this.getCodeActions.bind(this))
        this.connection.onExecuteCommand(this.executeCommand.bind(this))

        this.documents = new TextDocuments(TextDocument)
        this.documents.listen(this.connection)

        // Unknown-item diagnostics, pushed on open/change and cleared on close.
        // didOpen validates immediately; didChange is debounced per document
        // (one full-document scan per keystroke is wasteful).
        this.documents.onDidOpen((event) => this.validateSoon(event.document))
        this.documents.onDidChangeContent((event) => this.scheduleValidation(event.document))
        this.documents.onDidClose((event) => {
            const validate = this.validators.get(event.document.uri)
            if (validate) {
                validate.cancel()
                this.validators.delete(event.document.uri)
            }
            this.connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] })
        })

        // Item definitions + tags in the worktree's .items files (go-to-definition /
        // references / rename / tag completion). Root comes from initialize
        // params; scanned lazily on first use and refreshed on watched-file
        // events — one mtime-checked rescan of the changed file per event,
        // never a full-worktree rescan.
        this.index = null
        this.referenceIndex = null
        this.connection.onDidChangeWatchedFiles((params) => {
            for (const change of params.changes) {
                let file = null
                try {
                    file = fileURLToPath(change.uri)
                } catch {
                    continue // not a file:// URI
                }
                if (change.type === FileChangeType.Deleted) {
                    this.index?.removeFile(file)
                    this.referenceIndex?.removeFile(file)
                    continue
                }
                // Both indexes skip non-matching extensions and unchanged
                // mtimes internally.
                this.index?.refresh(file)
                this.referenceIndex?.refresh(file)
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

    /**
     * Lazily create the definition index and kick off the initial scan. The
     * scan reads every `.items` file in the worktree, so it runs async in
     * bounded batches instead of blocking the event loop; `readyIndex()`
     * awaits the in-flight scan (and the used-tag rescan it triggers).
     */
    getIndex() {
        if (!this.index) {
            const rootDir = this.rootDir
            if (!rootDir) {
                return null
            }
            this.index = new ItemIndex({ rootDir })
            this.indexScan = this.index
                .scanAsync()
                .then(() => {
                    this.log(`indexed ${this.index.size} item definitions under ${rootDir}`)
                })
                .catch((error) => this.log(`index scan failed: ${error.message}`))
        }
        return this.index
    }

    /** The definition index, awaited until the initial scan has finished. */
    async readyIndex() {
        const index = this.getIndex()
        if (this.indexScan) {
            await this.indexScan
        }
        return index
    }

    /**
     * Lazily create the reference index (cached text of the worktree's
     * openHAB source files) and kick off its initial scan. References and
     * rename search this cache instead of re-walking and re-reading the
     * worktree synchronously on every request.
     */
    getReferenceIndex() {
        if (!this.referenceIndex) {
            const rootDir = this.rootDir
            if (!rootDir) {
                return null
            }
            this.referenceIndex = new ReferenceIndex({ rootDir })
            this.referenceScan = this.referenceIndex
                .scanAsync()
                .then((files) => {
                    this.log(`cached ${files} openHAB source files under ${rootDir}`)
                })
                .catch((error) => this.log(`reference scan failed: ${error.message}`))
        }
        return this.referenceIndex
    }

    /** The reference index, awaited until the initial scan has finished. */
    async readyReferenceIndex() {
        const index = this.getReferenceIndex()
        if (this.referenceScan) {
            await this.referenceScan
        }
        return index
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
        // `connection.client.capabilities` is NOT populated by
        // vscode-languageserver 7.0 (the RemoteClientImpl.initialize() is a
        // no-op), so read the client capabilities from the initialize params
        // — same object, and always present.
        this.clientCapabilities = params.capabilities || {}
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
                inlayHintProvider: true,
                semanticTokensProvider: {
                    legend: SEMANTIC_TOKEN_LEGEND,
                    full: true,
                },
                codeActionProvider: {
                    codeActionKinds: ['quickfix'],
                },
                executeCommandProvider: {
                    // createItemFromChannel is listed so Zed keeps command-style
                    // entries resolvable, but its actions carry the edit directly.
                    commands: ['openhab.sendCommand', 'openhab.runRule', 'openhab.createItemFromChannel'],
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
        await this.thingTypes.load(this.settings)
        await this.things.start(this.settings)
        // Things may have loaded (or reloaded) after the open documents were
        // validated — re-run validation so channel links are checked.
        for (const document of this.documents.all()) {
            this.validateSoon(document)
        }
    }

    /**
     * Ask the client for the `openhab` section. Returns `undefined` when the
     * client cannot answer, so the caller keeps initializationOptions.
     */
    async readClientConfiguration() {
        const capabilities = this.clientCapabilities || this.connection.client.capabilities || {}
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
            // Stop everything that talks to the instance — not just the item
            // store; otherwise the things event stream keeps running.
            this.store.stop()
            this.things.stop()
            return
        }
        // Re-enabling after a disable is a full restart, not a connection-key
        // diff: the stores were stopped when the LSP was disabled.
        const reconnected =
            !previous.lspEnabled ||
            CONNECTION_KEYS.some((key) => JSON.stringify(previous[key]) !== JSON.stringify(this.settings[key]))
        if (reconnected) {
            await this.store.restart(this.settings)
            await this.thingTypes.load(this.settings)
            this.things.stop()
            await this.things.start(this.settings)
            for (const document of this.documents.all()) {
                this.validateSoon(document)
            }
        }
    }

    /** Completion scoped to the positions where openHAB accepts item names. */
    async getCompletion(params) {
        const document = this.documents.get(params.textDocument.uri)
        if (!document) {
            return { isIncomplete: false, items: [] }
        }
        const extension = extensionOf(params.textDocument.uri)
        const context = completion.contextAt(document, params.position)

        if (completion.isItemTypePosition(extension, context)) {
            return { isIncomplete: false, items: completion.typeCompletions() }
        }
        // `.items`: channel="…" value completion.
        const channelPartial = completion.channelValuePartial(extension, context)
        if (channelPartial !== null) {
            return {
                isIncomplete: false,
                items: completion.channelCompletions(channelPartial, this.things.allChannels),
            }
        }
        // `.items`: `<icon>` clause completion.
        const iconPartial = icons.iconPartial(extension, context)
        if (iconPartial !== null) {
            return { isIncomplete: false, items: icons.iconCompletions(iconPartial) }
        }
        // `.items`: `["…"]` semantic-tag completion, plus tags already
        // used in the worktree's .items files.
        const tagPartial = semantictags.tagPartial(extension, context)
        if (tagPartial !== null) {
            // Make sure the project-local tag set is scanned before use.
            await this.readyIndex()
            return {
                isIncomplete: false,
                items: semantictags.tagCompletions(tagPartial, this.usedTags()),
            }
        }
        // `.things`: thing-type UID completion after `Thing `/`Bridge `.
        const uidPartial = completion.thingUidPartial(extension, context)
        if (uidPartial !== null) {
            return {
                isIncomplete: false,
                items: completion.thingUidCompletions(uidPartial, this.thingTypes.bindingIds, (b) =>
                    this.thingTypes.uidsForBinding(b),
                ),
            }
        }
        if (!completion.offersItems(extension, context)) {
            return { isIncomplete: false, items: [] }
        }
        return { isIncomplete: false, items: this.itemCompletionItems() }
    }

    /**
     * Item-name completions, cached until the live item cache changes (keyed
     * on the store's generation). Completion fires per keystroke; rebuilding
     * thousands of items every time nothing changed is pure waste.
     */
    itemCompletionItems() {
        if (!this._itemCompletions || this._itemCompletionsGeneration !== this.store.generation) {
            this._itemCompletions = completion.itemCompletions(this.store.all)
            this._itemCompletionsGeneration = this.store.generation
        }
        return this._itemCompletions
    }

    /** Hover: live state of the item under the cursor, when it is a known item. */
    getHover(params) {
        const document = this.documents.get(params.textDocument.uri)
        if (!document) {
            return null
        }
        const word = hover.wordAt(document, params.position)
        if (!word) {
            return null
        }
        const item = this.store.items.get(word)
        if (!item) {
            // Most hovered words are not items (keywords, locals, labels);
            // a missing hover is never an error, so stay silent.
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
    async getDefinition(params) {
        const document = this.documents.get(params.textDocument.uri)
        if (!document) {
            return null
        }
        const word = hover.wordAt(document, params.position)
        if (!word) {
            return null
        }
        const index = await this.readyIndex()
        const def = index && index.get(word)
        if (!def) {
            return null
        }
        return { uri: def.uri, range: def.range }
    }

    /** Absolute paths of all open documents (may include files outside the scanned root). */
    openDocumentPaths() {
        return [...this.documents.all()]
            .map((d) => {
                try {
                    return fileURLToPath(d.uri)
                } catch {
                    return null
                }
            })
            .filter(Boolean)
    }

    /**
     * References: every usage of the item under the cursor across the
     * worktree's openHAB files. `includeDeclaration` adds the definition.
     */
    async getReferences(params) {
        const document = this.documents.get(params.textDocument.uri)
        if (!document) {
            return []
        }
        const word = hover.wordAt(document, params.position)
        if (!word) {
            return []
        }
        const rootDir = this.rootDir
        if (!rootDir) {
            return []
        }
        const referenceIndex = await this.readyReferenceIndex()
        // Include any open documents even if outside the scanned root.
        const extraFiles = this.openDocumentPaths()
        const locations = (referenceIndex && referenceIndex.findReferences(word, { extraFiles })) || []
        if (params.context?.includeDeclaration) {
            const index = await this.readyIndex()
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
    async prepareRename(params) {
        const document = this.documents.get(params.textDocument.uri)
        if (!document) {
            return null
        }
        const at = hover.wordRangeAt(document, params.position)
        if (!at || !NAME_RE.test(at.word)) {
            return null
        }
        const word = at.word
        const index = await this.readyIndex()
        const known = (index && index.has(word)) || this.store.items.has(word)
        if (!known) {
            return null
        }
        return { range: at.range, placeholder: word }
    }

    /**
     * Rename: rewrite every reference (and the definition) of the item to the
     * new name, as a WorkspaceEdit grouped by file. Workspace-text only — the
     * running openHAB instance is not renamed (that would need a REST call
     * and is a deliberate non-goal for now).
     */
    async rename(params) {
        const document = this.documents.get(params.textDocument.uri)
        if (!document) {
            return null
        }
        const word = hover.wordAt(document, params.position)
        const newName = params.newName
        if (!word || !NAME_RE.test(newName)) {
            return null
        }
        const rootDir = this.rootDir
        if (!rootDir) {
            return null
        }
        const referenceIndex = await this.readyReferenceIndex()
        const extraFiles = this.openDocumentPaths()
        const locations = (referenceIndex && referenceIndex.findReferences(word, { extraFiles })) || []
        const index = await this.readyIndex()
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
     * Inlay hints: the live state of every item name in the document, shown
     * right after the name (`Kitchen_Light  ON`). Only items present in the
     * live cache get a hint — a locally-defined-but-never-created item has no
     * state to show. The range covers the name; the label sits after it
     * (position = name end, paddingLeft so there is a space).
     */
    getInlayHints(params) {
        const document = this.documents.get(params.textDocument.uri)
        if (!document) {
            return []
        }
        const extension = extensionOf(document.uri)
        if (!OPENHAB_EXTENSIONS.includes(extension)) {
            return []
        }
        const hints = []
        for (const pos of findItemOccurrences(document.getText(), extension)) {
            const item = this.store.items.get(pos.name)
            if (!item || !item.state) {
                continue
            }
            hints.push({
                position: pos.range.end,
                label: ` ${item.state}`,
                kind: 1, // LSP InlayHintKind.Type; Zed renders the label either way
                paddingLeft: false,
                paddingRight: true,
            })
        }
        return hints
    }

    /**
     * Semantic tokens (full document): item references as `variable`, item
     * definitions (the name token in `.items`) as `property` + `declaration`.
     * Built with SemanticTokensBuilder so the LSP delta encoding is correct.
     */
    getSemanticTokens(params) {
        const document = this.documents.get(params.textDocument.uri)
        if (!document) {
            return { data: [] }
        }
        const extension = extensionOf(document.uri)
        if (!OPENHAB_EXTENSIONS.includes(extension)) {
            return { data: [] }
        }
        const builder = new SemanticTokensBuilder()
        for (const pos of findItemOccurrences(document.getText(), extension)) {
            builder.push(
                pos.range.start.line,
                pos.range.start.character,
                pos.range.end.character - pos.range.start.character,
                pos.isDefinition ? TOKEN_ITEM_DEF : TOKEN_ITEM_REF,
                pos.isDefinition ? MOD_DECLARATION : 0,
            )
        }
        return builder.build()
    }

    /**
     * Ask the client to re-pull inlay hints and semantic tokens for all open
     * openHAB documents. Called (debounced, via `this.clientRefresh`) when the
     * live item cache changes (event stream), so hints follow state changes
     * without an edit.
     *
     * Note the capability path: LSP puts `refreshSupport` on the *workspace*
     * capabilities (`workspace.inlayHint.refreshSupport`,
     * `workspace.semanticTokens.refreshSupport`) — `textDocument.inlayHint`
     * only has `resolveSupport`/`dynamicRegistration`. Zed advertises both
     * workspace refresh supports as true.
     */
    sendClientRefresh() {
        // Read from initialize params (see initialize()); fall back to the
        // connection's client object for libraries that do populate it.
        const caps = this.clientCapabilities || this.connection?.client?.capabilities || {}
        let sent = 0
        if (caps.workspace?.inlayHint?.refreshSupport) {
            this.connection?.sendRequest('workspace/inlayHint/refresh').catch(() => {})
            sent += 1
        }
        if (caps.workspace?.semanticTokens?.refreshSupport) {
            this.connection?.sendRequest('workspace/semanticTokens/refresh').catch(() => {})
            sent += 1
        }
        if (sent) {
            this.log(`item cache changed; requested client refresh (${sent})`)
        }
    }

    /**
     * Code actions: run rule, send command to an item, create item from
     * a channel. See codeActions.js for the position rules.
     */
    async getCodeActions(params) {
        const document = this.documents.get(params.textDocument.uri)
        if (!document) {
            return []
        }
        const extension = extensionOf(params.textDocument.uri)
        await this.readyIndex()
        return codeActionsAt(document, extension, params, {
            itemFor: (name) => this.store.items.get(name),
            isKnownItem: (name) => this.isKnownItem(name),
            channelsOf: (thingUID) => this.things.channelsOf(thingUID),
        })
    }

    /**
     * Execute a code-action command. Commands that touch the running
     * openHAB instance do a REST call; `createItemFromChannel` returns a
     * WorkspaceEdit (applied by the client) — Zed collects
     * `last_workspace_edits_by_language_server`, so returning the edit from
     * the executeCommand handler is enough for it to be applied.
     */
    async executeCommand(params) {
        const [name, command] = params.arguments || []
        switch (params.command) {
            case 'openhab.sendCommand': {
                if (!this.store.config) {
                    this.log('sendCommand: openHAB not connected; ignoring')
                    return null
                }
                if (!name || !command || !NAME_RE.test(name)) {
                    return null
                }
                const response = await fetch(`${this.store.baseUrl}/items/${encodeURIComponent(name)}`, {
                    method: 'POST',
                    headers: { ...this.store.authHeaders, 'Content-Type': 'text/plain' },
                    body: String(command),
                })
                if (!response.ok) {
                    this.log(`sendCommand ${command} -> ${name} failed: HTTP ${response.status}`)
                    return null
                }
                this.log(`sent ${command} to ${name}`)
                return null
            }
            case 'openhab.runRule': {
                if (!name || !this.store.config) {
                    if (name) {
                        this.log('runRule: openHAB not connected; ignoring')
                    }
                    return null
                }
                // POST /rest/rules/{uid}/run takes the rule UID, not the
                // `rule "…"` display name (DSL rule UIDs are auto-generated),
                // so resolve name -> UID via GET /rest/rules first.
                let uid = name
                try {
                    const list = await fetch(`${this.store.baseUrl}/rules`, { headers: this.store.authHeaders })
                    if (list.ok) {
                        const rules = await list.json()
                        const found = Array.isArray(rules) && rules.find((r) => r.name === name || r.uid === name)
                        if (found) {
                            uid = found.uid
                        }
                    }
                } catch {
                    // fall through and try the name as UID
                }
                // openHAB's endpoint is /rules/{uid}/runnow (there is no /run);
                // it calls ruleManager.runNow(uid, considerConditions=false),
                // i.e. the "when" triggers/conditions are NOT evaluated — only
                // the "then" actions run, with a synthetic ExecutionEvent.
                const response = await fetch(`${this.store.baseUrl}/rules/${encodeURIComponent(uid)}/runnow`, {
                    method: 'POST',
                    headers: { ...this.store.authHeaders, 'Content-Type': 'application/json' },
                    body: '{}',
                })
                if (!response.ok) {
                    this.log(`run rule ${name} (uid ${uid}) failed: HTTP ${response.status}`)
                    return null
                }
                this.log(`ran rule ${name}`)
                return null
            }
            default:
                // openhab.createItemFromChannel needs no handler: its CodeAction
                // carries the WorkspaceEdit directly (Zed applies that, and
                // ignores executeCommand results when applying a picked action).
                return null
        }
    }

    /**
     * Semantic tags already used in the worktree's `.items` files — extracted
     * by the index scan (one read feeds definitions and tags) and refreshed
     * per file on watched-file events. Offered before the built-in ontology
     * list so project-local tags complete first.
     *
     * @returns {Set<string>}
     */
    usedTags() {
        const index = this.getIndex()
        return index ? index.usedTags : new Set()
    }

    /**
     * Position-aware project-known check for the unknown-tag diagnostic: a
     * tag counts as known from the project only if some `.items` line OTHER
     * than `exclude` uses it (a tag appearing solely on the line being
     * checked is not evidence it is established). Live-instance tags always
     * count.
     */
    isKnownTagAt(tag, exclude) {
        const usages = this.index?.tagUsages.get(tag)
        if (usages && usages.some((u) => !(u.file === exclude.file && u.line === exclude.line))) {
            return true
        }
        return this.store.liveTags.has(tag)
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
     * Debounced validation for a changed document: didChangeContent fires per
     * keystroke and each run scans the whole document, so a burst of changes
     * coalesces into one validation `VALIDATION_DEBOUNCE_MS` after the last
     * change (one debounced validator per document URI).
     */
    scheduleValidation(document) {
        let validate = this.validators.get(document.uri)
        if (!validate) {
            validate = debounce((doc) => this.validateSoon(doc), VALIDATION_DEBOUNCE_MS)
            this.validators.set(document.uri, validate)
        }
        validate(document)
    }

    /** Fire-and-forget validation entry point (didOpen / didChange / reconnect). */
    validateSoon(document) {
        this.validateDocument(document).catch((error) => this.log(`validateDocument failed: ${error.message}`))
    }

    /**
     * Publish diagnostics for unknown item references in an open document.
     * Runs on didOpen and debounced on didChange; cleared on didClose.
     * Awaits the initial index scan first so `isKnownItem`/`isKnownTagAt`
     * see the worktree's definitions (no false warnings during the scan).
     */
    async validateDocument(document) {
        if (!document) {
            return
        }
        const extension = extensionOf(document.uri)
        if (!OPENHAB_EXTENSIONS.includes(extension)) {
            return
        }
        await this.readyIndex()
        const text = document.getText()
        const found = findUnknownItemRefs(text, extension, (name) => this.isKnownItem(name))
        // `.items` additionally gets unknown-semantic-tag warnings:
        // known = ontology ∪ tags used elsewhere in the worktree ∪ tags on
        // live items from the REST cache.
        if (extension === 'items') {
            let file = null
            try {
                file = fileURLToPath(document.uri)
            } catch {
                /* non-file uri */
            }
            found.push(
                ...findUnknownTags(text, (tag, pos) =>
                    file ? this.isKnownTagAt(tag, { file, line: pos.line }) : this.isKnownTagAt(tag, { file: null, line: -1 }),
                ),
            )
            // Channel links are only checked when the thing cache actually
            // loaded — an unreachable instance must not flag every channel.
            if (this.things.loaded) {
                found.push(
                    ...findUnknownChannels(text, {
                        isKnownThing: (thingUID) => this.things.hasThing(thingUID),
                        isKnownChannel: (uid) => this.things.hasChannel(uid),
                    }),
                )
            }
        }
        this.connection.sendDiagnostics({
            uri: document.uri,
            diagnostics: found.map((d) => ({
                range: d.range,
                severity: d.severity ?? 2, // Warning (channel errors pass 1)
                source: 'openhab-lsp',
                message: d.message,
            })),
        })
    }

    exit() {
        this.clientRefresh?.cancel()
        for (const validate of this.validators?.values() || []) {
            validate.cancel()
        }
        this.validators?.clear()
        this.store.stop()
        this.things.stop()
    }
}

module.exports = Server
