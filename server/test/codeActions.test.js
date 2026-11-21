'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { codeActionsAt, createItemEdit, itemNameFromChannelUid } = require('../src/codeActions')

const ITEM = { name: 'Kitchen_Light', type: 'Switch', state: 'ON' }
const ctx = {
    itemFor: (name) => (name === 'Kitchen_Light' ? ITEM : undefined),
    isKnownItem: (name) => name === 'Kitchen_Light' || name === 'gAll',
    channelsOf: (thingUID) =>
        thingUID === 'hue:0210:1:bulb1'
            ? [{ uid: 'hue:0210:1:bulb1:color', itemType: 'Color', label: 'Color' }]
            : [],
}

function params(line, character, uri = 'file:///tmp/wt/demo.rules') {
    return {
        textDocument: { uri },
        range: { start: { line, character }, end: { line, character } },
        context: { diagnostics: [] },
    }
}

test('sendCommand actions for a Switch item in a rule body', () => {
    const text = 'rule "x"\nthen\n    Kitchen_Light.sendCommand(ON)\nend\n'
    const actions = codeActionsAt(text, 'rules', params(2, 5), ctx)
    const titles = actions.map((a) => a.title)
    assert.deepStrictEqual(titles, ['Send ON to Kitchen_Light', 'Send OFF to Kitchen_Light'])
    assert.ok(actions.every((a) => a.kind === 'quickfix' && a.command.command === 'openhab.sendCommand'))
    assert.deepStrictEqual(actions[0].command.arguments, ['Kitchen_Light', 'ON'])
})

test('runRule action on a rule header line', () => {
    const text = 'rule "Evening Lights"\nwhen\n    Item X changed\nthen\nend\n'
    const actions = codeActionsAt(text, 'rules', params(0, 3), ctx)
    assert.strictEqual(actions.length, 1)
    assert.strictEqual(actions[0].command.command, 'openhab.runRule')
    assert.deepStrictEqual(actions[0].command.arguments, ['Evening Lights'])
    // Not offered mid-body.
    assert.deepStrictEqual(codeActionsAt(text, 'rules', params(2, 5), ctx).filter((a) => a.command.command === 'openhab.runRule'), [])
})

test('no actions for an unknown word or a non-item position in rules', () => {
    const text = 'rule "x"\nthen\n    logInfo("x", "y")\nend\n'
    assert.deepStrictEqual(codeActionsAt(text, 'rules', params(2, 5), ctx), [])
})

test('createItemFromChannel action on a channel="…" line in .items carries the edit on the action', () => {
    const text = 'Switch Old "Old" { channel="hue:0210:1:bulb1:color" }\n'
    const actions = codeActionsAt(text, 'items', params(0, 30, 'file:///tmp/wt/lamps.items'), ctx)
    assert.strictEqual(actions.length, 1)
    // Zed applies the edit from the CodeAction itself (it ignores
    // executeCommand results when a picked action is applied).
    assert.strictEqual(actions[0].command, undefined)
    const edit = actions[0].edit
    assert.ok(edit.changes['file:///tmp/wt/lamps.items'])
    const change = edit.changes['file:///tmp/wt/lamps.items'][0]
    assert.ok(change.newText.includes('Color Hue_0210_1_Bulb1_Color'))
    assert.ok(change.newText.includes('channel="hue:0210:1:bulb1:color"'))
    assert.ok(actions[0].title.includes('Color'))
})

test('sendCommand is offered on the .items definition name too', () => {
    const text = 'Switch Kitchen_Light "K" (gAll)\n'
    const actions = codeActionsAt(text, 'items', params(0, 10, 'file:///tmp/wt/lamps.items'), ctx)
    assert.deepStrictEqual(actions.map((a) => a.title), ['Send ON to Kitchen_Light', 'Send OFF to Kitchen_Light'])
    // Not on the group-list reference (that is a group, not this item).
    assert.deepStrictEqual(codeActionsAt(text, 'items', params(0, 28, 'file:///tmp/wt/lamps.items'), ctx), [])
})

test('no channel action when the thing is unknown (openHAB offline)', () => {
    const text = 'Switch Old "Old" { channel="unknown:thing:ch" }\n'
    assert.deepStrictEqual(codeActionsAt(text, 'items', params(0, 30, 'file:///tmp/wt/lamps.items'), ctx), [])
})

test('sendCommand in .sitemap for a known item', () => {
    const text = 'sitemap demo { Switch item=Kitchen_Light label="K" }\n'
    const actions = codeActionsAt(text, 'sitemap', params(0, 30, 'file:///tmp/wt/demo.sitemap'), ctx)
    assert.deepStrictEqual(actions.map((a) => a.title), ['Send ON to Kitchen_Light', 'Send OFF to Kitchen_Light'])
})

test('itemNameFromChannelUid produces valid item names', () => {
    assert.strictEqual(itemNameFromChannelUid('hue:0210:1:bulb1:color'), 'Hue_0210_1_Bulb1_Color')
    assert.strictEqual(itemNameFromChannelUid('mqtt:broker:0:temperature'), 'Mqtt_Broker_0_Temperature')
    assert.ok(/^[A-Za-z_]\w*$/.test(itemNameFromChannelUid('9lives:ch')))
})

test('createItemEdit appends a definition at the end of the file', () => {
    const uri = 'file:///tmp/wt/lamps.items'
    const text = 'Switch Old "Old"\n'
    const edit = createItemEdit(uri, text, { name: 'Hue_0210_1_Bulb1_Color', itemType: 'Color', channelUID: 'hue:0210:1:bulb1:color' })
    const changes = edit.changes[uri]
    assert.strictEqual(changes.length, 1)
    assert.deepStrictEqual(changes[0].range.start, { line: 1, character: 0 })
    assert.strictEqual(changes[0].newText, 'Color Hue_0210_1_Bulb1_Color "Hue_0210_1_Bulb1_Color" { channel="hue:0210:1:bulb1:color" }\n')
})

test('createItemEdit on an empty file does not prepend a newline', () => {
    const edit = createItemEdit('file:///x.items', '', { name: 'X', itemType: 'Switch', channelUID: 'a:b:c' })
    assert.strictEqual(edit.changes['file:///x.items'][0].newText.startsWith('\n'), false)
})
