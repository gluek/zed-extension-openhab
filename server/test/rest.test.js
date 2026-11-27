'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { normalizeBaseUrl, baseUrlFor, authHeadersFor, SseParser } = require('../src/rest')

test('normalizeBaseUrl: bare host gets http:// and the configured port', () => {
    assert.strictEqual(normalizeBaseUrl('localhost', 8080), 'http://localhost:8080')
    assert.strictEqual(normalizeBaseUrl('h', 'not-a-port'), 'http://h:8080')
    assert.strictEqual(normalizeBaseUrl(undefined, undefined), 'http://localhost:8080')
})

test('normalizeBaseUrl: host:port wins over the port setting; full URLs pass through', () => {
    assert.strictEqual(normalizeBaseUrl('openhab.local:9090', 8080), 'http://openhab.local:9090')
    assert.strictEqual(normalizeBaseUrl('https://oh.example.de/', 443), 'https://oh.example.de')
})

test('baseUrlFor appends /rest', () => {
    assert.strictEqual(baseUrlFor({ host: 'localhost', port: 8080 }), 'http://localhost:8080/rest')
})

test('authHeadersFor: empty without credentials; Bearer wins over Basic', () => {
    assert.deepStrictEqual(authHeadersFor({}), {})
    assert.deepStrictEqual(authHeadersFor({ authToken: 't', basicAuth: { username: 'u', password: 'p' } }), {
        Authorization: 'Bearer t',
    })
    assert.strictEqual(authHeadersFor({ basicAuth: { username: 'u', password: 'p' } }).Authorization, 'Basic dTpw')
})

test('SseParser buffers a data: line split across chunks', () => {
    const sse = new SseParser()
    const bytes = Buffer.from('data: {"topic":"openhab/items/X/state"}\n', 'utf8')
    const cut = 10 // split mid-line
    assert.deepStrictEqual(sse.feed(bytes.subarray(0, cut)), [])
    assert.deepStrictEqual(sse.feed(bytes.subarray(cut)), ['{"topic":"openhab/items/X/state"}'])
})

test('SseParser handles a multi-byte UTF-8 char split across chunks', () => {
    const sse = new SseParser()
    const bytes = Buffer.from('data: "ü"\n', 'utf8')
    const cut = 8 // inside the two-byte ü
    assert.deepStrictEqual(sse.feed(bytes.subarray(0, cut)), [])
    assert.deepStrictEqual(sse.feed(bytes.subarray(cut)), ['"ü"'])
})

test('SseParser skips non-data lines and flushes a trailing data: line at end()', () => {
    const sse = new SseParser()
    assert.deepStrictEqual(sse.feed(Buffer.from(': keepalive\n\n')), [])
    assert.deepStrictEqual(sse.feed(Buffer.from('data: abc')), [])
    assert.deepStrictEqual(sse.end(), ['abc'])
})
