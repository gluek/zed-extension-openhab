'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { mock } = require('node:test')

const { normalizeBaseUrl, baseUrlFor, authHeadersFor, SseParser, debounce, sendCommand, runRule } = require('../src/rest')

test('normalizeBaseUrl: bare host gets http:// and the configured port', () => {
    assert.strictEqual(normalizeBaseUrl('localhost', 8080), 'http://localhost:8080')
    assert.strictEqual(normalizeBaseUrl('h', 'not-a-port'), 'http://h:8080')
    assert.strictEqual(normalizeBaseUrl(undefined, undefined), 'http://localhost:8080')
})

test('normalizeBaseUrl: host:port wins over the port setting; full URLs pass through', () => {
    assert.strictEqual(normalizeBaseUrl('openhab.local:9090', 8080), 'http://openhab.local:9090')
    assert.strictEqual(normalizeBaseUrl('https://oh.example.de/', 443), 'https://oh.example.de')
})

test('normalizeBaseUrl: IPv6 literals are bracketed and keep the configured port', () => {
    assert.strictEqual(normalizeBaseUrl('::1', 8080), 'http://[::1]:8080')
    assert.strictEqual(normalizeBaseUrl('fe80::1', 9090), 'http://[fe80::1]:9090')
    assert.strictEqual(normalizeBaseUrl('[::1]', 8080), 'http://[::1]:8080')
    assert.strictEqual(normalizeBaseUrl('[::1]:8443', 8080), 'http://[::1]:8443')
    assert.strictEqual(normalizeBaseUrl('[2001:db8::1]:8080/', 8080), 'http://[2001:db8::1]:8080')
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

test('debounce collapses a burst into one trailing call and resets on each call', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
        let calls = 0
        const fn = debounce(() => {
            calls += 1
        }, 200)
        fn()
        fn()
        fn()
        mock.timers.tick(199)
        assert.strictEqual(calls, 0)
        mock.timers.tick(1)
        assert.strictEqual(calls, 1)
        fn()
        mock.timers.tick(200)
        assert.strictEqual(calls, 2)
    } finally {
        mock.timers.reset()
    }
})

test('debounce cancel() drops a pending call', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
        let calls = 0
        const fn = debounce(() => {
            calls += 1
        }, 200)
        fn()
        fn.cancel()
        mock.timers.tick(1000)
        assert.strictEqual(calls, 0)
    } finally {
        mock.timers.reset()
    }
})

test('sendCommand posts the command to the item endpoint with auth headers', async () => {
    const calls = []
    const realFetch = globalThis.fetch
    globalThis.fetch = async (url, opts = {}) => {
        calls.push({ url: String(url), opts })
        return { ok: true, status: 200 }
    }
    try {
        const rest = { baseUrl: 'http://h:1/rest', authHeaders: { Authorization: 'Bearer t' } }
        assert.deepStrictEqual(await sendCommand(rest, 'Kitchen_Light', 'ON'), { ok: true, status: 200 })
        assert.strictEqual(calls.length, 1)
        assert.strictEqual(calls[0].url, 'http://h:1/rest/items/Kitchen_Light')
        assert.strictEqual(calls[0].opts.method, 'POST')
        assert.strictEqual(calls[0].opts.body, 'ON')
        assert.strictEqual(calls[0].opts.headers.Authorization, 'Bearer t')
        assert.strictEqual(calls[0].opts.headers['Content-Type'], 'text/plain')
    } finally {
        globalThis.fetch = realFetch
    }
})

test('sendCommand reports a failed POST without throwing', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = async () => ({ ok: false, status: 404 })
    try {
        const rest = { baseUrl: 'http://h:1/rest', authHeaders: {} }
        assert.deepStrictEqual(await sendCommand(rest, 'Ghost', 'ON'), { ok: false, status: 404 })
    } finally {
        globalThis.fetch = realFetch
    }
})

test('runRule resolves the display name to a UID, then POSTs runnow', async () => {
    const calls = []
    const realFetch = globalThis.fetch
    globalThis.fetch = async (url, opts = {}) => {
        const u = String(url)
        calls.push({ url: u, opts })
        if (u.endsWith('/rules')) {
            return { ok: true, status: 200, json: async () => [{ uid: 'rule-uid-1', name: 'Evening' }] }
        }
        return { ok: true, status: 200 }
    }
    try {
        const rest = { baseUrl: 'http://h:1/rest', authHeaders: { Authorization: 'Bearer t' } }
        assert.deepStrictEqual(await runRule(rest, 'Evening'), { ok: true, status: 200, uid: 'rule-uid-1' })
        assert.strictEqual(calls[0].url, 'http://h:1/rest/rules')
        assert.strictEqual(calls[1].url, 'http://h:1/rest/rules/rule-uid-1/runnow')
        assert.strictEqual(calls[1].opts.method, 'POST')
        assert.strictEqual(calls[1].opts.body, '{}')
        assert.strictEqual(calls[1].opts.headers['Content-Type'], 'application/json')
        assert.strictEqual(calls[1].opts.headers.Authorization, 'Bearer t')
    } finally {
        globalThis.fetch = realFetch
    }
})

test('runRule falls back to the given name as the UID when the rule list is unavailable', async () => {
    const calls = []
    const realFetch = globalThis.fetch
    globalThis.fetch = async (url, opts = {}) => {
        const u = String(url)
        calls.push(u)
        if (u.endsWith('/rules')) {
            throw new Error('offline')
        }
        return { ok: false, status: 404 }
    }
    try {
        const rest = { baseUrl: 'http://h:1/rest', authHeaders: {} }
        assert.deepStrictEqual(await runRule(rest, 'my-uid'), { ok: false, status: 404, uid: 'my-uid' })
        assert.deepStrictEqual(calls, ['http://h:1/rest/rules', 'http://h:1/rest/rules/my-uid/runnow'])
    } finally {
        globalThis.fetch = realFetch
    }
})
