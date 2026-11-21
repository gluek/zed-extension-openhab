'use strict'

/**
 * End-to-end test: runs the bundled server over stdio against a fake openHAB
 * REST API, and checks that item completions come back for a `.rules` file.
 */

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const { spawn } = require('node:child_process')
const path = require('node:path')

const SERVER = path.join(__dirname, '..', 'openhab-language-server.js')

/** Minimal openHAB stand-in: item list plus an event stream that stays open. */
function startFakeOpenHAB(items) {
    const streams = [] // open SSE response objects, so tests can push events
    const posted = [] // captured POST requests (sendCommand / runRule)
    const server = http.createServer((req, res) => {
        // POST handlers must come first: '/rest/items' prefix-matches
        // '/rest/items/<name>' too.
        if (req.method === 'POST' && req.url.startsWith('/rest/items/')) {
            let body = ''
            req.on('data', (c) => (body += c))
            req.on('end', () => {
                posted.push({ url: req.url, body })
                res.writeHead(200)
                res.end()
            })
            return
        }
        if (req.method === 'POST' && req.url.startsWith('/rest/rules/')) {
            posted.push({ url: req.url, body: '' })
            res.writeHead(200)
            res.end()
            return
        }
        if (req.url.startsWith('/rest/rules')) {
            // Rule list: the DSL rule's UID differs from its display name.
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify([{ uid: 'rule-uid-1', name: 'Evening', status: { status: 'IDLE' } }]))
            return
        }
        if (req.url.startsWith('/rest/items')) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(items))
            return
        }
        if (req.url.startsWith('/rest/thing-types')) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify([
                { UID: 'hue:0210', label: 'Hue Bulb' },
                { UID: 'hue:bridge:office', label: 'Hue Bridge', bridge: true },
                { UID: 'mqtt:broker', label: 'MQTT Broker', bridge: true },
            ]))
            return
        }
        if (req.url.startsWith('/rest/things')) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify([
                {
                    UID: 'hue:0210:1:bulb1',
                    channels: [
                        { uid: 'hue:0210:1:bulb1:color', label: 'Color', itemType: 'Color' },
                        { uid: 'hue:0210:1:bulb1:brightness', label: 'Brightness', itemType: 'Dimmer' },
                    ],
                },
            ]))
            return
        }
        if (req.url.startsWith('/rest/events')) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' })
            // flushHeaders matters: Node buffers the response headers until the
            // first body write, and fetch waits for headers — without this the
            // client's fetch never resolves and the stream is never registered.
            res.flushHeaders()
            // Keep the connection open like openHAB does; remember the stream
            // so tests can push SSE events through it.
            streams.push(res)
            req.on('close', () => res.end())
            return
        }
        res.writeHead(404)
        res.end()
    })
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () =>
            resolve({
                server,
                port: server.address().port,
                posted,
                /** Push one SSE event to all connected streams. */
                pushEvent: (topic, type, payload) => {
                    const line = `data: ${JSON.stringify({ topic, type, payload: JSON.stringify(payload) })}\n\n`
                    for (const res of streams) {
                        res.write(line)
                    }
                },
            }),
        )
    })
}

/** Speak just enough LSP to drive one completion request. */
function startClient(port) {
    const child = spawn(process.execPath, [SERVER, '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let buffer = Buffer.alloc(0)
    const pending = new Map()
    const notifications = []

    child.stdout.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk])
        for (;;) {
            const headerEnd = buffer.indexOf('\r\n\r\n')
            if (headerEnd === -1) return
            const header = buffer.slice(0, headerEnd).toString()
            const match = /Content-Length: (\d+)/i.exec(header)
            if (!match) return
            const length = Number(match[1])
            const start = headerEnd + 4
            if (buffer.length < start + length) return
            const message = JSON.parse(buffer.slice(start, start + length).toString())
            buffer = buffer.slice(start + length)
            if (message.id !== undefined && pending.has(message.id)) {
                pending.get(message.id)(message)
                pending.delete(message.id)
            } else if (message.method) {
                notifications.push(message)
                // Answer server->client requests so it does not wedge.
                if (message.id !== undefined) {
                    send({ jsonrpc: '2.0', id: message.id, result: null })
                }
            }
        }
    })

    function send(message) {
        const body = JSON.stringify(message)
        child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    }

    function request(id, method, params) {
        return new Promise((resolve) => {
            pending.set(id, resolve)
            send({ jsonrpc: '2.0', id, method, params })
        })
    }

    return { child, send, request, notifications }
}

test('serves item completions for a .rules document end to end', async () => {
    const items = [
        { name: 'Kitchen_Light', type: 'Switch', state: 'ON', tags: [], groupNames: [] },
        { name: 'Weather_Temperature', type: 'Number', state: 'NULL', tags: [], groupNames: [] },
    ]
    const { server, port } = await startFakeOpenHAB(items)
    const client = startClient(port)

    try {
        await client.request(1, 'initialize', {
            processId: process.pid,
            rootUri: null,
            // Advertise no workspace/configuration so initializationOptions is used.
            capabilities: {},
            initializationOptions: { host: '127.0.0.1', port, lspEnabled: true },
        })
        client.send({ jsonrpc: '2.0', method: 'initialized', params: {} })

        const uri = 'file:///tmp/demo.rules'
        client.send({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: {
                textDocument: { uri, languageId: 'openhab', version: 1, text: 'rule "x"\nthen\n    Kitchen_\nend\n' },
            },
        })

        // Give the store a moment to fetch the item list.
        await new Promise((resolve) => setTimeout(resolve, 500))

        const response = await client.request(2, 'textDocument/completion', {
            textDocument: { uri },
            position: { line: 2, character: 12 },
        })
        const labels = response.result.items.map((i) => i.label).sort()
        assert.deepStrictEqual(labels, ['Kitchen_Light', 'Weather_Temperature'])
    } finally {
        client.child.kill()
        server.close()
    }
})

test('returns no item completions inside a string literal', async () => {
    const { server, port } = await startFakeOpenHAB([
        { name: 'Kitchen_Light', type: 'Switch', state: 'ON', tags: [], groupNames: [] },
    ])
    const client = startClient(port)

    try {
        await client.request(1, 'initialize', {
            processId: process.pid,
            rootUri: null,
            capabilities: {},
            initializationOptions: { host: '127.0.0.1', port, lspEnabled: true },
        })
        client.send({ jsonrpc: '2.0', method: 'initialized', params: {} })

        const uri = 'file:///tmp/demo.rules'
        client.send({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: {
                textDocument: { uri, languageId: 'openhab', version: 1, text: 'logInfo("Kitchen_\n' },
            },
        })
        await new Promise((resolve) => setTimeout(resolve, 500))

        const response = await client.request(2, 'textDocument/completion', {
            textDocument: { uri },
            position: { line: 0, character: 17 },
        })
        assert.deepStrictEqual(response.result.items, [])
    } finally {
        client.child.kill()
        server.close()
    }
})

/** Temp worktree with an .items file and a .rules file referencing an item. */
function makeWorktree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openhab-lsp-'))
    fs.writeFileSync(
        path.join(dir, 'lamps.items'),
        'Switch Kitchen_Light "Kitchen Light" <light> (gAll)\nGroup gAll "All"\n',
    )
    fs.writeFileSync(
        path.join(dir, 'demo.rules'),
        'rule "x"\nwhen\n    Item Kitchen_Light changed\nthen\n    Kitchen_Light.sendCommand(ON)\nend\n',
    )
    return dir
}

test('definition, references, prepareRename, and rename over stdio', async () => {
    const dir = makeWorktree()
    const { server, port } = await startFakeOpenHAB([
        { name: 'Kitchen_Light', type: 'Switch', state: 'ON', tags: [], groupNames: [] },
    ])
    const client = startClient(port)
    const itemsUri = 'file://' + path.join(dir, 'lamps.items')
    const rulesUri = 'file://' + path.join(dir, 'demo.rules')

    try {
        await client.request(1, 'initialize', {
            processId: process.pid,
            rootUri: 'file://' + dir,
            workspaceFolders: [{ uri: 'file://' + dir, name: 'wt' }],
            capabilities: {},
            initializationOptions: { host: '127.0.0.1', port, lspEnabled: true },
        })
        client.send({ jsonrpc: '2.0', method: 'initialized', params: {} })

        client.send({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: {
                textDocument: {
                    uri: rulesUri,
                    languageId: 'openhab',
                    version: 1,
                    text: fs.readFileSync(path.join(dir, 'demo.rules'), 'utf8'),
                },
            },
        })
        await new Promise((resolve) => setTimeout(resolve, 500))

        // 1. Go-to-definition from the trigger reference (line 2, "Kitchen_Light").
        const def = await client.request(2, 'textDocument/definition', {
            textDocument: { uri: rulesUri },
            position: { line: 2, character: 10 },
        })
        assert.strictEqual(def.result.uri, itemsUri)
        assert.deepStrictEqual(def.result.range.start, { line: 0, character: 7 })

        // 2. References without declaration: trigger + body = 2 locations.
        const refs = await client.request(3, 'textDocument/references', {
            textDocument: { uri: rulesUri },
            position: { line: 4, character: 5 },
            context: { includeDeclaration: false },
        })
        assert.strictEqual(refs.result.length, 2)
        assert.ok(refs.result.every((l) => l.uri === rulesUri))

        // 3. References with declaration: +1 definition in lamps.items.
        const refsDecl = await client.request(4, 'textDocument/references', {
            textDocument: { uri: rulesUri },
            position: { line: 4, character: 5 },
            context: { includeDeclaration: true },
        })
        assert.strictEqual(refsDecl.result.length, 3)
        assert.ok(refsDecl.result.some((l) => l.uri === itemsUri))

        // 4. prepareRename returns the word range.
        const prep = await client.request(5, 'textDocument/prepareRename', {
            textDocument: { uri: rulesUri },
            position: { line: 4, character: 5 },
        })
        assert.deepStrictEqual(prep.result.range, {
            start: { line: 4, character: 4 },
            end: { line: 4, character: 4 + 'Kitchen_Light'.length },
        })

        // 5. rename produces a WorkspaceEdit covering all 3 locations.
        const ren = await client.request(6, 'textDocument/rename', {
            textDocument: { uri: rulesUri },
            position: { line: 4, character: 5 },
            newName: 'Kitchen_Lamp',
        })
        const uris = Object.keys(ren.result.changes).sort()
        assert.deepStrictEqual(uris, [itemsUri, rulesUri].sort())
        const edits = ren.result.changes[rulesUri]
        assert.strictEqual(edits.length, 2)
        assert.ok(edits.every((e) => e.newText === 'Kitchen_Lamp'))
        assert.deepStrictEqual(ren.result.changes[itemsUri][0].range.start, { line: 0, character: 7 })

        // 6. prepareRename rejects an unknown word.
        const prepBad = await client.request(7, 'textDocument/prepareRename', {
            textDocument: { uri: rulesUri },
            position: { line: 0, character: 2 }, // inside `rule`
        })
        assert.strictEqual(prepBad.result, null)
        assert.ok(prepBad.error || prepBad.result === null)
    } finally {
        client.child.kill()
        server.close()
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

test('publishes unknown-item diagnostics for a .rules document over stdio', async () => {
    const dir = makeWorktree()
    fs.writeFileSync(
        path.join(dir, 'demo.rules'),
        'rule "x"\nwhen\n    Item Kitchen_Light changed\n    Item Kitchen_Lght changed\nthen\n    Kitchen_Lght.sendCommand(ON)\nend\n',
    )
    const { server, port } = await startFakeOpenHAB([
        { name: 'Kitchen_Light', type: 'Switch', state: 'ON', tags: [], groupNames: [] },
    ])
    const client = startClient(port)
    const rulesUri = 'file://' + path.join(dir, 'demo.rules')

    try {
        await client.request(1, 'initialize', {
            processId: process.pid,
            rootUri: 'file://' + dir,
            workspaceFolders: [{ uri: 'file://' + dir, name: 'wt' }],
            capabilities: {},
            initializationOptions: { host: '127.0.0.1', port, lspEnabled: true },
        })
        client.send({ jsonrpc: '2.0', method: 'initialized', params: {} })

        client.send({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: {
                textDocument: {
                    uri: rulesUri,
                    languageId: 'openhab',
                    version: 1,
                    text: fs.readFileSync(path.join(dir, 'demo.rules'), 'utf8'),
                },
            },
        })
        await new Promise((resolve) => setTimeout(resolve, 500))

        const pubs = client.notifications.filter((n) => n.method === 'textDocument/publishDiagnostics' && n.params.uri === rulesUri)
        assert.ok(pubs.length >= 1, 'expected at least one publishDiagnostics notification')
        const diags = pubs[pubs.length - 1].params.diagnostics
        // Kitchen_Lght at the trigger (3:9) and the sendCommand (5:4) are
        // unknown; Kitchen_Light is known (in .items and on the instance).
        assert.deepStrictEqual(
            diags.map((d) => `${d.range.start.line}:${d.range.start.character}`).sort(),
            ['3:9', '5:4'],
        )
        assert.ok(diags.every((d) => d.severity === 2 && d.source === 'openhab-lsp'))
        assert.ok(diags.every((d) => d.message.includes('Kitchen_Lght')))

        // Fix the typo -> diagnostics clear on didChange.
        client.send({
            jsonrpc: '2.0',
            method: 'textDocument/didChange',
            params: {
                textDocument: { uri: rulesUri, version: 2 },
                contentChanges: [
                    { text: fs.readFileSync(path.join(dir, 'demo.rules'), 'utf8').replaceAll('Kitchen_Lght', 'Kitchen_Light') },
                ],
            },
        })
        await new Promise((resolve) => setTimeout(resolve, 300))
        const pubs2 = client.notifications.filter((n) => n.method === 'textDocument/publishDiagnostics' && n.params.uri === rulesUri)
        assert.deepStrictEqual(pubs2[pubs2.length - 1].params.diagnostics, [])
    } finally {
        client.child.kill()
        server.close()
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

test('serves inlay hints and semantic tokens for item names over stdio', async () => {
    const dir = makeWorktree()
    fs.writeFileSync(
        path.join(dir, 'demo.rules'),
        'rule "x"\nwhen\n    Item Kitchen_Light changed\nthen\n    Kitchen_Light.sendCommand(ON)\nend\n',
    )
    const fake = await startFakeOpenHAB([
        { name: 'Kitchen_Light', type: 'Switch', state: 'ON', tags: [], groupNames: [] },
        { name: 'gAll', type: 'Group', state: 'OFF', tags: [], groupNames: [] },
    ])
    const { server, port } = fake
    const client = startClient(port)
    const rulesUri = 'file://' + path.join(dir, 'demo.rules')
    const itemsUri = 'file://' + path.join(dir, 'lamps.items')

    try {
        const init = await client.request(1, 'initialize', {
            processId: process.pid,
            rootUri: 'file://' + dir,
            workspaceFolders: [{ uri: 'file://' + dir, name: 'wt' }],
            capabilities: {
                workspace: {
                    // Zed advertises refresh support at the *workspace* level.
                    inlayHint: { refreshSupport: true },
                    semanticTokens: { refreshSupport: true },
                },
            },
            initializationOptions: { host: '127.0.0.1', port, lspEnabled: true },
        })
        assert.strictEqual(init.result.capabilities.inlayHintProvider, true)
        assert.deepStrictEqual(init.result.capabilities.semanticTokensProvider.legend.tokenTypes, ['variable', 'property'])
        client.send({ jsonrpc: '2.0', method: 'initialized', params: {} })

        const rulesText = fs.readFileSync(path.join(dir, 'demo.rules'), 'utf8')
        const itemsText = fs.readFileSync(path.join(dir, 'lamps.items'), 'utf8')
        client.send({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: { textDocument: { uri: rulesUri, languageId: 'openhab', version: 1, text: rulesText } },
        })
        client.send({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: { textDocument: { uri: itemsUri, languageId: 'openhab', version: 1, text: itemsText } },
        })
        await new Promise((resolve) => setTimeout(resolve, 500))

        // 1. Inlay hints in .rules: one per item occurrence, label = live state.
        const hints = await client.request(2, 'textDocument/inlayHint', {
            textDocument: { uri: rulesUri },
            range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } },
        })
        assert.deepStrictEqual(
            hints.result.map((h) => `${h.position.line}:${h.position.character}:${h.label}`),
            ['2:22: ON', '4:17: ON'],
        )

        // 2. Inlay hints in .items: Kitchen_Light definition (ON), the gAll
        // group ref on line 0 (OFF), and the gAll definition on line 1 (OFF).
        const itemHints = await client.request(3, 'textDocument/inlayHint', {
            textDocument: { uri: itemsUri },
            range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
        })
        assert.deepStrictEqual(
            itemHints.result.map((h) => `${h.position.line}:${h.position.character}:${h.label}`),
            ['0:20: ON', '0:50: OFF', '1:10: OFF'],
        )

        // 3. Semantic tokens in .rules: both occurrences are `variable` (type 0, mod 0).
        const tokens = await client.request(4, 'textDocument/semanticTokens/full', {
            textDocument: { uri: rulesUri },
        })
        // Decode the delta-encoded flat array: [dLine, dChar, length, type, mods] per token.
        const data = tokens.result.data
        const decoded = []
        let line = 0
        let char = 0
        for (let i = 0; i < data.length; i += 5) {
            line += data[i]
            char = data[i] === 0 ? char + data[i + 1] : data[i + 1]
            decoded.push(`${line}:${char} len=${data[i + 2]} type=${data[i + 3]} mod=${data[i + 4]}`)
        }
        assert.deepStrictEqual(decoded, ['2:9 len=13 type=0 mod=0', '4:4 len=13 type=0 mod=0'])

        // 4. Semantic tokens in .items: definition = property+declaration (type 1, mod 1).
        const itemTokens = await client.request(5, 'textDocument/semanticTokens/full', {
            textDocument: { uri: itemsUri },
        })
        const d2 = itemTokens.result.data
        const decoded2 = []
        line = 0
        char = 0
        for (let i = 0; i < d2.length; i += 5) {
            line += d2[i]
            char = d2[i] === 0 ? char + d2[i + 1] : d2[i + 1]
            decoded2.push(`${line}:${char} len=${d2[i + 2]} type=${d2[i + 3]} mod=${d2[i + 4]}`)
        }
        assert.deepStrictEqual(decoded2, [
            '0:7 len=13 type=1 mod=1', // Kitchen_Light definition
            '0:46 len=4 type=0 mod=0', // gAll group ref
            '1:6 len=4 type=1 mod=1', // gAll definition on line 1
        ])

        // 5. Live update: push an SSE state event; the server must send
        // workspace/inlayHint/refresh (client advertised refreshSupport at
        // the *workspace* level, like Zed does), and a re-pull must show OFF.
        const refreshBefore = client.notifications.filter((n) => n.method === 'workspace/inlayHint/refresh').length
        fake.pushEvent('openhab/items/Kitchen_Light/statechanged', 'ItemStateChangedEvent', { type: 'OnOff', value: 'OFF' })
        await new Promise((resolve) => setTimeout(resolve, 400))
        const refreshAfter = client.notifications.filter((n) => n.method === 'workspace/inlayHint/refresh').length
        assert.ok(refreshAfter > refreshBefore, 'expected workspace/inlayHint/refresh after the SSE event')
        const hints2 = await client.request(6, 'textDocument/inlayHint', {
            textDocument: { uri: rulesUri },
            range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } },
        })
        assert.deepStrictEqual(
            hints2.result.map((h) => `${h.position.line}:${h.position.character}:${h.label}`),
            ['2:22: OFF', '4:17: OFF'],
        )
    } finally {
        client.child.kill()
        server.close()
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

test('code actions: sendCommand, runRule, createItemFromChannel over stdio', async () => {
    const dir = makeWorktree()
    fs.writeFileSync(
        path.join(dir, 'demo.rules'),
        'rule "Evening"\nwhen\n    Item Kitchen_Light changed\nthen\n    Kitchen_Light.sendCommand(ON)\nend\n',
    )
    fs.writeFileSync(
        path.join(dir, 'lamps.items'),
        'Switch Kitchen_Light "Kitchen Light" <light> (gAll) { channel="hue:0210:1:bulb1:color" }\nGroup gAll "All"\n',
    )
    const fake = await startFakeOpenHAB([
        { name: 'Kitchen_Light', type: 'Switch', state: 'ON', tags: [], groupNames: [] },
    ])
    const { server, port, posted } = fake
    const client = startClient(port)
    const rulesUri = 'file://' + path.join(dir, 'demo.rules')
    const itemsUri = 'file://' + path.join(dir, 'lamps.items')

    try {
        const init = await client.request(1, 'initialize', {
            processId: process.pid,
            rootUri: 'file://' + dir,
            workspaceFolders: [{ uri: 'file://' + dir, name: 'wt' }],
            capabilities: {},
            initializationOptions: { host: '127.0.0.1', port, lspEnabled: true },
        })
        assert.deepStrictEqual(init.result.capabilities.executeCommandProvider.commands.sort(), [
            'openhab.createItemFromChannel',
            'openhab.runRule',
            'openhab.sendCommand',
        ])
        client.send({ jsonrpc: '2.0', method: 'initialized', params: {} })

        const rulesText = fs.readFileSync(path.join(dir, 'demo.rules'), 'utf8')
        const itemsText = fs.readFileSync(path.join(dir, 'lamps.items'), 'utf8')
        client.send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: rulesUri, languageId: 'openhab', version: 1, text: rulesText } } })
        client.send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: itemsUri, languageId: 'openhab', version: 1, text: itemsText } } })
        await new Promise((resolve) => setTimeout(resolve, 500))

        // 1. Code actions on the rule header: runRule.
        const headerActions = await client.request(2, 'textDocument/codeAction', {
            textDocument: { uri: rulesUri },
            range: { start: { line: 0, character: 3 }, end: { line: 0, character: 3 } },
            context: { diagnostics: [] },
        })
        const runRule = headerActions.result.find((a) => a.command?.command === 'openhab.runRule')
        assert.ok(runRule, `expected runRule action, got ${JSON.stringify(headerActions.result)}`)
        assert.deepStrictEqual(runRule.command.arguments, ['Evening'])

        // 2. Code actions on the item name in the rule body: sendCommand ON/OFF.
        const bodyActions = await client.request(3, 'textDocument/codeAction', {
            textDocument: { uri: rulesUri },
            range: { start: { line: 4, character: 5 }, end: { line: 4, character: 5 } },
            context: { diagnostics: [] },
        })
        const sendCmds = bodyActions.result.filter((a) => a.command?.command === 'openhab.sendCommand')
        assert.deepStrictEqual(sendCmds.map((a) => a.command.arguments[1]).sort(), ['OFF', 'ON'])

        // 3. Execute sendCommand OFF -> the fake API must receive the POST.
        await client.request(4, 'workspace/executeCommand', {
            command: 'openhab.sendCommand',
            arguments: ['Kitchen_Light', 'OFF'],
        })
        await new Promise((resolve) => setTimeout(resolve, 300))
        assert.deepStrictEqual(posted, [{ url: '/rest/items/Kitchen_Light', body: 'OFF' }])

        // 4. Execute runRule -> the server resolves name -> UID via
        // GET /rest/rules, then POSTs /rest/rules/rule-uid-1/run.
        await client.request(5, 'workspace/executeCommand', {
            command: 'openhab.runRule',
            arguments: ['Evening'],
        })
        await new Promise((resolve) => setTimeout(resolve, 300))
        assert.ok(posted.some((p) => p.url === '/rest/rules/rule-uid-1/run'), `got ${JSON.stringify(posted)}`)

        // 5. Code actions on the channel="…" line in .items: the action
        // carries the WorkspaceEdit directly (Zed applies action edits and
        // ignores executeCommand results).
        const itemActions = await client.request(6, 'textDocument/codeAction', {
            textDocument: { uri: itemsUri },
            range: { start: { line: 0, character: 60 }, end: { line: 0, character: 60 } },
            context: { diagnostics: [] },
        })
        const create = itemActions.result.find((a) => a.title.includes('Create item'))
        assert.ok(create, `expected create-item action, got ${JSON.stringify(itemActions.result)}`)
        assert.strictEqual(create.command, undefined)
        const edit = create.edit
        assert.ok(edit.changes[itemsUri], `expected edit for ${itemsUri}, got ${JSON.stringify(create)}`)
        const change = edit.changes[itemsUri][0]
        assert.ok(change.newText.includes('Color Hue_0210_1_Bulb1_Color'))
        assert.ok(change.newText.includes('channel="hue:0210:1:bulb1:color"'))

        // 6. Code actions on the .items definition name: sendCommand.
        const defActions = await client.request(7, 'textDocument/codeAction', {
            textDocument: { uri: itemsUri },
            range: { start: { line: 0, character: 10 }, end: { line: 0, character: 10 } },
            context: { diagnostics: [] },
        })
        const defSends = defActions.result.filter((a) => a.command?.command === 'openhab.sendCommand')
        assert.deepStrictEqual(defSends.map((a) => a.command.arguments[1]).sort(), ['OFF', 'ON'])
    } finally {
        client.child.kill()
        server.close()
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

test('offers thing-type completions in a .things file end to end', async () => {
    const { server, port } = await startFakeOpenHAB([])
    const client = startClient(port)
    try {
        await client.request(1, 'initialize', {
            processId: process.pid,
            rootUri: null,
            capabilities: {},
            initializationOptions: { host: '127.0.0.1', port, lspEnabled: true },
        })
        client.send({ jsonrpc: '2.0', method: 'initialized', params: {} })

        const uri = 'file:///tmp/demo.things'
        client.send({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: {
                textDocument: { uri, languageId: 'openhab', version: 1, text: 'Thing \n' },
            },
        })
        await new Promise((resolve) => setTimeout(resolve, 500))

        // After `Thing ` with nothing typed: binding IDs.
        const bindings = await client.request(2, 'textDocument/completion', {
            textDocument: { uri },
            position: { line: 0, character: 6 },
        })
        assert.deepStrictEqual(
            bindings.result.items.map((i) => i.label).sort(),
            ['hue', 'mqtt'],
        )

        // After `Thing hue:`: thing-type UIDs of the hue binding.
        client.send({
            jsonrpc: '2.0',
            method: 'textDocument/didChange',
            params: {
                textDocument: { uri, version: 2 },
                contentChanges: [{ text: 'Thing hue:\n' }],
            },
        })
        const uids = await client.request(3, 'textDocument/completion', {
            textDocument: { uri },
            position: { line: 0, character: 10 },
        })
        assert.deepStrictEqual(
            uids.result.items.map((i) => i.label).sort(),
            ['hue:0210', 'hue:bridge:office'],
        )

        // Not in a UID position (inside a config value): no thing completions.
        client.send({
            jsonrpc: '2.0',
            method: 'textDocument/didChange',
            params: {
                textDocument: { uri, version: 3 },
                contentChanges: [{ text: 'Thing hue:0210 "X" [ id="1" ]\n' }],
            },
        })
        const none = await client.request(4, 'textDocument/completion', {
            textDocument: { uri },
            position: { line: 0, character: 30 },
        })
        assert.deepStrictEqual(none.result.items, [])
    } finally {
        client.child.kill()
        server.close()
    }
})

test('offers channel UID completions inside channel="…" in .items end to end', async () => {
    const { server, port } = await startFakeOpenHAB([])
    const client = startClient(port)
    try {
        await client.request(1, 'initialize', {
            processId: process.pid,
            rootUri: null,
            capabilities: {},
            initializationOptions: { host: '127.0.0.1', port, lspEnabled: true },
        })
        client.send({ jsonrpc: '2.0', method: 'initialized', params: {} })

        const uri = 'file:///tmp/demo.items'
        const text = 'Switch Kitchen_Light "K" { channel="hue:0210:1:bulb1:\n'
        client.send({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: { textDocument: { uri, languageId: 'openhab', version: 1, text } },
        })
        await new Promise((resolve) => setTimeout(resolve, 500))

        const response = await client.request(2, 'textDocument/completion', {
            textDocument: { uri },
            position: { line: 0, character: text.length },
        })
        assert.deepStrictEqual(
            response.result.items.map((i) => i.label).sort(),
            ['hue:0210:1:bulb1:brightness', 'hue:0210:1:bulb1:color'],
        )

        // Outside channel="…" (in the label string): no channel completions.
        client.send({
            jsonrpc: '2.0',
            method: 'textDocument/didChange',
            params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: 'Switch Kitchen_Light "hue:0210\n' }] },
        })
        const none = await client.request(3, 'textDocument/completion', {
            textDocument: { uri },
            position: { line: 0, character: 30 },
        })
        assert.ok(!none.result.items.some((i) => i.label.includes('bulb1')))
    } finally {
        client.child.kill()
        server.close()
    }
})
