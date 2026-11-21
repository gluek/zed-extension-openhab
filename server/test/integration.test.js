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
    const server = http.createServer((req, res) => {
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
        if (req.url.startsWith('/rest/events')) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' })
            // Keep the connection open like openHAB does.
            req.on('close', () => res.end())
            return
        }
        res.writeHead(404)
        res.end()
    })
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
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
