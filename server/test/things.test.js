'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { mock } = require('node:test')

const { ThingStore } = require('../src/things')
const { isChannelValuePosition, channelCompletions } = require('../src/completion')

const THINGS = [
    {
        UID: 'hue:0210:1:bulb1',
        channels: [
            { uid: 'hue:0210:1:bulb1:color', label: 'Color', itemType: 'Color' },
            { uid: 'hue:0210:1:bulb1:brightness', label: 'Brightness', itemType: 'Dimmer' },
        ],
    },
    {
        UID: 'mqtt:broker:nuc',
        channels: [{ uid: 'mqtt:broker:nuc:status', label: 'Status', itemType: 'String' }],
    },
]

function store() {
    const s = new ThingStore()
    s.config = { host: 'h', port: 1 }
    for (const t of THINGS) {
        s.channelsByThing.set(t.UID, t.channels)
    }
    return s
}

test('allChannels flattens and sorts channel UIDs across things', () => {
    const all = store().allChannels
    assert.deepStrictEqual(
        all.map((c) => c.uid),
        ['hue:0210:1:bulb1:brightness', 'hue:0210:1:bulb1:color', 'mqtt:broker:nuc:status'],
    )
})

test('channelsOf returns one thing’s channels', () => {
    assert.strictEqual(store().channelsOf('hue:0210:1:bulb1').length, 2)
    assert.deepStrictEqual(store().channelsOf('nope'), [])
})

test('hasThing / hasChannel answer from the cache', () => {
    const s = store()
    assert.strictEqual(s.hasThing('hue:0210:1:bulb1'), true)
    assert.strictEqual(s.hasThing('nope'), false)
    assert.strictEqual(s.hasChannel('hue:0210:1:bulb1:color'), true)
    assert.strictEqual(s.hasChannel('hue:0210:1:bulb1:nope'), false)
    assert.strictEqual(s.hasChannel('nope:thing:channel'), false)
})

test('loaded is false until /rest/things succeeds, true after', async () => {
    const s = new ThingStore()
    assert.strictEqual(s.loaded, false)
    s.config = { host: '127.0.0.1', port: 1 } // unreachable
    await s.load()
    assert.strictEqual(s.loaded, false)
    for (const t of THINGS) s.channelsByThing.set(t.UID, t.channels)
    s.loaded = true
    assert.strictEqual(s.hasChannel('mqtt:broker:nuc:status'), true)
})

test('isChannelValuePosition fires only inside channel="…" in .items', () => {
    assert.ok(isChannelValuePosition('items', { before: '{ channel="hue:' }))
    assert.ok(isChannelValuePosition('items', { before: 'Switch X "x" { channel="' }))
    assert.ok(!isChannelValuePosition('items', { before: 'Switch X "x" { autoupdate="' }))
    assert.ok(!isChannelValuePosition('items', { before: '{ channel="closed" ' }))
    assert.ok(!isChannelValuePosition('things', { before: '{ channel="' }))
    assert.ok(!isChannelValuePosition('rules', { before: 'channel="' }))
})

test('channelCompletions matches by prefix and by channel-id suffix', () => {
    const all = store().allChannels
    const byPrefix = channelCompletions('hue:0210:1:bulb1:', all)
    assert.deepStrictEqual(byPrefix.map((c) => c.label), ['hue:0210:1:bulb1:brightness', 'hue:0210:1:bulb1:color'])

    const bySuffix = channelCompletions('color', all)
    assert.deepStrictEqual(bySuffix.map((c) => c.label), ['hue:0210:1:bulb1:color'])

    const none = channelCompletions('zzz', all)
    assert.deepStrictEqual(none, [])
})

test('ThingStore.load never throws on unreachable host', async () => {
    const logs = []
    const s = new ThingStore({ log: (m) => logs.push(m) })
    s.config = { host: '127.0.0.1', port: 1 }
    await s.load()
    assert.deepStrictEqual(s.channelsByThing.size, 0)
    assert.ok(logs.some((m) => /cannot load things/.test(m)))
})

test('listen() aborts the previous event stream when re-listening (no stream stacking)', async () => {
    const realFetch = globalThis.fetch
    const eventSignals = []
    const streamControllers = []
    let thingsLoads = 0
    globalThis.fetch = async (url, opts = {}) => {
        if (String(url).includes('/events')) {
            const signal = opts.signal
            eventSignals.push(signal)
            let controller
            const body = new ReadableStream({
                start(c) {
                    controller = c
                    signal?.addEventListener('abort', () => {
                        try {
                            c.error(new DOMException('aborted', 'AbortError'))
                        } catch {
                            /* stream already closed */
                        }
                    })
                },
            })
            streamControllers.push(controller)
            return { ok: true, status: 200, body }
        }
        thingsLoads += 1
        return { ok: true, status: 200, json: async () => THINGS }
    }
    mock.timers.enable({ apis: ['setTimeout'] })
    const s = new ThingStore({ log: () => {} })
    try {
        await s.start({ host: 'h', port: 1 })
        // start() -> load() + listen(): exactly one event stream is open.
        assert.strictEqual(eventSignals.length, 1)
        assert.strictEqual(eventSignals[0].aborted, false)

        // One thing event -> scheduleRefetch() (1 s debounce, mocked timer).
        streamControllers[0].enqueue(
            new TextEncoder().encode('data: {"topic":"openhab/things/hue:0210:1:bulb1/added","type":"ThingAddedEvent","payload":"{}"}\n\n'),
        )
        await new Promise((resolve) => setImmediate(resolve))
        mock.timers.tick(1000)
        // The timer runs load().then(() => listen()); wait for the second stream.
        for (let i = 0; i < 50 && eventSignals.length < 2; i++) {
            await new Promise((resolve) => setImmediate(resolve))
        }
        assert.strictEqual(eventSignals.length, 2, 'refetch should open a second stream')
        assert.strictEqual(eventSignals[0].aborted, true, 'the first stream must be aborted, not leaked')
        assert.strictEqual(eventSignals[1].aborted, false)
        assert.strictEqual(thingsLoads, 2, 'the refetch reloads /rest/things exactly once')
    } finally {
        s.stop()
        mock.timers.reset()
        globalThis.fetch = realFetch
    }
})
