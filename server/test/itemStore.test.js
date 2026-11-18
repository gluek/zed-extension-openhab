'use strict'

const test = require('node:test')
const assert = require('node:assert')

const ItemStore = require('../src/ItemStore')

/** Build an SSE `data:` payload the way openHAB sends it. */
function event(topic, type, payload) {
    return JSON.stringify({ topic, type, payload: JSON.stringify(payload) })
}

/** Store seeded with `Kitchen_Light`, without touching the network. */
function seededStore() {
    const logs = []
    const store = new ItemStore({ log: (m) => logs.push(m) })
    store.configure({ host: 'localhost', port: 8080 })
    store.items.set('Kitchen_Light', new (require('../src/Item'))({ name: 'Kitchen_Light', type: 'Switch', state: 'ON' }))
    return { store, logs }
}

test('basic auth header is only sent when a username is set', () => {
    const store = new ItemStore()
    store.configure({ host: 'h', port: 1 })
    assert.deepStrictEqual(store.authHeaders, {})

    store.configure({ host: 'h', port: 1, basicAuth: { username: 'u', password: 'p' } })
    assert.strictEqual(store.authHeaders.Authorization, 'Basic dTpw')
})

test('authToken wins over basic auth (openHAB 4 API tokens)', () => {
    const store = new ItemStore()
    store.configure({ host: 'h', port: 1, authToken: 'abc', basicAuth: { username: 'u', password: 'p' } })
    assert.strictEqual(store.authHeaders.Authorization, 'Bearer abc')
})

test('port defaults when absent or invalid', () => {
    const store = new ItemStore()
    store.configure({ host: 'h' })
    assert.strictEqual(store.config.port, 8080)
    store.configure({ host: 'h', port: 'not-a-port' })
    assert.strictEqual(store.config.port, 8080)
})

test('ItemStateEvent updates the cached state and type', () => {
    const { store } = seededStore()
    store.handleEvent(event('smarthome/items/Kitchen_Light/state', 'ItemStateEvent', { type: 'OnOff', value: 'OFF' }))
    assert.strictEqual(store.items.get('Kitchen_Light').state, 'OFF')
})

test('ItemStateChangedEvent with a bare string payload still works', () => {
    const { store } = seededStore()
    store.handleEvent(event('smarthome/items/Kitchen_Light/statechanged', 'ItemStateChangedEvent', 'OFF'))
    assert.strictEqual(store.items.get('Kitchen_Light').state, 'OFF')
})

test('ItemAddedEvent and ItemRemovedEvent resize the cache', () => {
    const { store } = seededStore()
    store.handleEvent(event('smarthome/items/D1', 'ItemAddedEvent', { name: 'D1', type: 'Dimmer', state: '50' }))
    assert.strictEqual(store.size, 2)
    store.handleEvent(event('smarthome/items/D1', 'ItemRemovedEvent', { name: 'D1' }))
    assert.strictEqual(store.size, 1)
})

test('ItemUpdatedEvent takes the new copy from the [new, old] payload', () => {
    const { store } = seededStore()
    store.handleEvent(
        event('smarthome/items/Kitchen_Light', 'ItemUpdatedEvent', [
            { name: 'Kitchen_Light', type: 'Switch', label: 'Renamed' },
            { name: 'Kitchen_Light', type: 'Switch' },
        ]),
    )
    assert.strictEqual(store.items.get('Kitchen_Light').label, 'Renamed')
})

test('malformed events are ignored rather than throwing', () => {
    const { store } = seededStore()
    assert.doesNotThrow(() => store.handleEvent('not json'))
    assert.doesNotThrow(() => store.handleEvent(JSON.stringify({ topic: '', type: 'x', payload: '1' })))
    assert.strictEqual(store.size, 1)
})

test('all() is sorted by name for stable completion order', () => {
    const store = new ItemStore()
    store.configure({ host: 'h', port: 1 })
    const Item = require('../src/Item')
    store.items.set('Zed', new Item({ name: 'Zed', type: 'Switch' }))
    store.items.set('Alpha', new Item({ name: 'Alpha', type: 'Switch' }))
    assert.deepStrictEqual(store.all.map((i) => i.name), ['Alpha', 'Zed'])
})

test('stop() clears the cache and the config by default', () => {
    const { store } = seededStore()
    store.stop()
    assert.strictEqual(store.size, 0)
    assert.strictEqual(store.config, undefined)
    assert.ok(store.stopped)
})

test('restart() survives an unreachable host without throwing', async () => {
    const logs = []
    const store = new ItemStore({ log: (m) => logs.push(m) })
    // Port 1 is not listening; the failure must be logged, not raised.
    await store.restart({ host: '127.0.0.1', port: 1 })
    assert.ok(logs.some((m) => /cannot reach openHAB/.test(m)))
    store.stop()
})
