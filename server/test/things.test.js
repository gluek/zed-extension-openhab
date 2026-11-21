'use strict'

const test = require('node:test')
const assert = require('node:assert')

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
