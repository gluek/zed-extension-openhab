'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { ThingTypeStore } = require('../src/thingTypes')
const { isThingUidPosition, thingUidCompletions } = require('../src/completion')

const TYPES = [
    { UID: 'hue:0210', label: 'Hue Bulb', bridge: false },
    { UID: 'hue:0017', label: 'Hue Dimmer', bridge: false },
    { UID: 'hue:bridge:office', label: 'Hue Bridge', bridge: true },
    { UID: 'mqtt:broker', label: 'MQTT Broker', bridge: true },
    { UID: 'mqtt:topic', label: 'MQTT Topic' },
    { UID: 'deconz:switch', label: 'deCONZ Switch' },
]

function store() {
    const s = new ThingTypeStore({ rest: () => ({ baseUrl: 'http://x/rest', authHeaders: {} }) })
    s.types = TYPES
    s.loaded = true
    return s
}

test('bindingIds returns sorted distinct bindings', () => {
    assert.deepStrictEqual(store().bindingIds, ['deconz', 'hue', 'mqtt'])
})

test('uidsForBinding returns full UIDs, and short IDs with shortIds', () => {
    const s = store()
    assert.deepStrictEqual(s.uidsForBinding('hue'), ['hue:0017', 'hue:0210', 'hue:bridge:office'])
    assert.deepStrictEqual(s.uidsForBinding('hue', { shortIds: true }), [
        '0017',
        '0210',
        'bridge:office',
        'hue:0017',
        'hue:0210',
        'hue:bridge:office',
    ])
})

test('isThingUidPosition fires only after Thing/Bridge in .things', () => {
    assert.ok(isThingUidPosition('things', { before: 'Thing ' }))
    assert.ok(isThingUidPosition('things', { before: '    Bridge hue:' }))
    assert.ok(!isThingUidPosition('things', { before: 'Thing hue:0210 "label" ' }))
    assert.ok(!isThingUidPosition('things', { before: 'Thing channel="x"' }))
    assert.ok(!isThingUidPosition('rules', { before: 'Thing ' }))
    assert.ok(!isThingUidPosition('things', { before: '// Thing ' }))
})

test('thingUidCompletions offers bindings without a colon, UIDs with one', () => {
    const s = store()
    const bindings = thingUidCompletions('', s.bindingIds, (b) => s.uidsForBinding(b))
    assert.deepStrictEqual(bindings.map((b) => b.label), ['deconz', 'hue', 'mqtt'])

    const hu = thingUidCompletions('hu', s.bindingIds, (b) => s.uidsForBinding(b))
    assert.deepStrictEqual(hu.map((b) => b.label), ['hue'])

    const hue = thingUidCompletions('hue:', s.bindingIds, (b) => s.uidsForBinding(b))
    assert.deepStrictEqual(hue.map((b) => b.label), ['hue:0017', 'hue:0210', 'hue:bridge:office'])

    const partial = thingUidCompletions('hue:02', s.bindingIds, (b) => s.uidsForBinding(b))
    assert.deepStrictEqual(partial.map((b) => b.label), ['hue:0210'])
})

test('ThingTypeStore.load handles failure without throwing', async () => {
    const logs = []
    const s = new ThingTypeStore({
        log: (m) => logs.push(m),
        rest: () => ({ baseUrl: 'http://127.0.0.1:1/rest', authHeaders: {} }),
    })
    await s.load({ host: '127.0.0.1', port: 1 })
    assert.strictEqual(s.loaded, false)
    assert.deepStrictEqual(s.types, [])
    assert.ok(logs.some((m) => /cannot load thing types/.test(m)))
})
