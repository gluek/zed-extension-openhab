'use strict'

const test = require('node:test')
const assert = require('node:assert')

const ItemStore = require('../src/ItemStore')
const Item = require('../src/Item')

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
    assert.strictEqual(store.baseUrl, 'http://h:8080/rest')
    store.configure({ host: 'h', port: 'not-a-port' })
    assert.strictEqual(store.baseUrl, 'http://h:8080/rest')
})

test('baseUrl accepts a full URL with scheme (https) as host', () => {
    const store = new ItemStore()
    store.configure({ host: 'https://openhab.intra.example.de', port: 443, authToken: 't' })
    assert.strictEqual(store.baseUrl, 'https://openhab.intra.example.de/rest')
})

test('baseUrl keeps an explicit port embedded in a bare host', () => {
    const store = new ItemStore()
    store.configure({ host: 'openhab.local:9090', port: 8080 })
    assert.strictEqual(store.baseUrl, 'http://openhab.local:9090/rest')
})

test('baseUrl strips trailing slashes from a URL host', () => {
    const store = new ItemStore()
    store.configure({ host: 'https://openhab.local/' })
    assert.strictEqual(store.baseUrl, 'https://openhab.local/rest')
})

test('ItemStateEvent updates the cached state and type', () => {
    const { store } = seededStore()
    store.handleEvent(event('smarthome/items/Kitchen_Light/state', 'ItemStateEvent', { type: 'OnOff', value: 'OFF' }))
    assert.strictEqual(store.items.get('Kitchen_Light').state, 'OFF')
})

test('ItemStateEvent on the openHAB 4 topic prefix (openhab/items) also updates the cache', () => {
    const { store } = seededStore()
    store.handleEvent(event('openhab/items/Kitchen_Light/state', 'ItemStateEvent', { type: 'OnOff', value: 'OFF' }))
    assert.strictEqual(store.items.get('Kitchen_Light').state, 'OFF')
    store.handleEvent(event('openhab/items/Kitchen_Light/statechanged', 'ItemStateChangedEvent', { type: 'OnOff', value: 'ON' }))
    assert.strictEqual(store.items.get('Kitchen_Light').state, 'ON')
})

test('event stream subscribes to both smarthome and openhab topic prefixes', () => {
    const store = new ItemStore()
    store.configure({ host: 'h', port: 1 })
    // The filter is a constant on the module; assert via the source of truth
    // by re-reading the constant through a listen() URL capture instead.
    // Simpler: check the module constant directly.
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ItemStore.js'), 'utf8')
    assert.ok(src.includes("smarthome/items/*,openhab/items/*"), 'EVENT_TOPICS covers both prefixes')
})

test('ItemStateChangedEvent with a bare string payload still works', () => {
    const { store } = seededStore()
    store.handleEvent(event('smarthome/items/Kitchen_Light/statechanged', 'ItemStateChangedEvent', 'OFF'))
    assert.strictEqual(store.items.get('Kitchen_Light').state, 'OFF')
})

test('ItemAddedEvent and ItemRemovedEvent resize the cache (openHAB 4 topic)', () => {
    const { store } = seededStore()
    store.handleEvent(event('openhab/items/D1/added', 'ItemAddedEvent', { name: 'D1', type: 'Dimmer', state: '50' }))
    assert.strictEqual(store.size, 2)
    store.handleEvent(event('openhab/items/D1/removed', 'ItemRemovedEvent', { name: 'D1' }))
    assert.strictEqual(store.size, 1)
})

test('ItemUpdatedEvent takes the new copy from the [new, old] payload', () => {
    const { store } = seededStore()
    store.handleEvent(
        event('openhab/items/Kitchen_Light/updated', 'ItemUpdatedEvent', [
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

test('onEvent fires on cache-changing events but not on malformed or unknown-item events', () => {
    let calls = 0
    const store = new ItemStore({ onEvent: () => { calls += 1 } })
    store.configure({ host: 'localhost', port: 8080 })
    store.items.set('Kitchen_Light', new (require('../src/Item'))({ name: 'Kitchen_Light', type: 'Switch', state: 'ON' }))

    store.handleEvent(event('openhab/items/Kitchen_Light/state', 'ItemStateEvent', { type: 'OnOff', value: 'OFF' }))
    assert.strictEqual(calls, 1)
    store.handleEvent(event('openhab/items/Kitchen_Light/added', 'ItemAddedEvent', { name: 'Kitchen_Light', type: 'Switch' }))
    assert.strictEqual(calls, 2)
    store.handleEvent(event('openhab/items/Ghost/state', 'ItemStateEvent', 'ON')) // unknown item: no change
    assert.strictEqual(calls, 2)
    store.handleEvent('not json')
    assert.strictEqual(calls, 2)
})

test('all() is sorted by name for stable completion order', () => {
    const store = new ItemStore()
    store.configure({ host: 'h', port: 1 })
    const Item = require('../src/Item')
    store.items.set('Zed', new Item({ name: 'Zed', type: 'Switch' }))
    store.items.set('Alpha', new Item({ name: 'Alpha', type: 'Switch' }))
    assert.deepStrictEqual(store.all.map((i) => i.name), ['Alpha', 'Zed'])
})

test('all() is cached until the cache changes; generation tracks changes', () => {
    const store = new ItemStore()
    store.configure({ host: 'h', port: 1 })
    store.items.set('Zed', new Item({ name: 'Zed', type: 'Switch' }))
    store.items.set('Alpha', new Item({ name: 'Alpha', type: 'Switch' }))

    const first = store.all
    assert.deepStrictEqual(first.map((i) => i.name), ['Alpha', 'Zed'])
    assert.strictEqual(store.all, first, 'the sorted array is cached, not re-sorted per call')

    const generation = store.generation
    // A cache-changing event invalidates the array and bumps the generation.
    store.handleEvent(event('openhab/items/Alpha/state', 'ItemStateEvent', { type: 'OnOff', value: 'ON' }))
    assert.ok(store.generation > generation)
    assert.notStrictEqual(store.all, first)
    assert.deepStrictEqual(store.all.map((i) => i.name), ['Alpha', 'Zed'])
    assert.strictEqual(store.all, store.all)

    // An event that changes nothing does not invalidate.
    const afterChange = store.all
    const generationAfterChange = store.generation
    store.handleEvent('not json')
    assert.strictEqual(store.all, afterChange)
    assert.strictEqual(store.generation, generationAfterChange)

    // stop() empties the cache and bumps the generation again.
    const beforeStop = store.generation
    store.stop()
    assert.deepStrictEqual(store.all, [])
    assert.ok(store.generation > beforeStop)
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

test('liveTags is the cached union of item tags and invalidates on change', () => {
    const { store } = seededStore()
    store.items.set('A', new Item({ name: 'A', type: 'Switch', tags: ['Lighting', 'Indoor'] }))
    store.items.set('B', new Item({ name: 'B', type: 'Switch', tags: ['Lighting'] }))
    const tags = store.liveTags
    assert.deepStrictEqual([...tags].sort(), ['Indoor', 'Lighting'])
    assert.strictEqual(store.liveTags, tags) // cached, not rebuilt
    // A state event invalidates the cache; the rebuilt set has the same content.
    store.handleEvent(event('openhab/items/A/state', 'ItemStateEvent', { type: 'OnOff', value: 'ON' }))
    assert.notStrictEqual(store.liveTags, tags)
    assert.deepStrictEqual([...store.liveTags].sort(), ['Indoor', 'Lighting'])
    // stop() clears the cache, so liveTags is empty again.
    store.stop()
    assert.strictEqual(store.liveTags.size, 0)
})
