'use strict'

/**
 * End-to-end test: runs the bundled server over stdio against a fake openHAB
 * REST API, and checks that item completions come back for a `.rules` file.
 */

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
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
        if (req.url.startsWith('/rest/events')) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' })
            // Keep the connection open like openHAB does.
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
