'use strict'

const test = require('node:test')
const assert = require('node:assert')

const Item = require('../src/Item')
const completion = require('../src/completion')
const { extensionOf } = require('../src/files')
const { TextDocument } = require('vscode-languageserver-textdocument')

const rawItem = {
    name: 'Kitchen_Temperature',
    type: 'Number',
    label: 'Kitchen Temperature [%.1f °C]',
    state: '21.5',
    dimension: 'Temperature',
    tags: ['Measurement'],
    groupNames: ['gWeather'],
}

test('contextAt splits the cursor line around the position', () => {
    const source = 'Switch Kitchen_Light "Light"\nDimmer D1\n'
    const ctx = completion.contextAt(source, { line: 1, character: 7 })
    assert.strictEqual(ctx.line, 'Dimmer D1')
    assert.strictEqual(ctx.before, 'Dimmer ')
    assert.strictEqual(ctx.after, 'D1')
})

test('contextAt tolerates a position past the end of the document', () => {
    const ctx = completion.contextAt('a\n', { line: 9, character: 0 })
    assert.strictEqual(ctx.line, '')
})

test('contextAt accepts a TextDocument and matches the plain-string form', () => {
    const source = 'Switch A "a"\r\nNumber B "b"\n'
    const doc = TextDocument.create('file:///x.items', 'openhab', 1, source)
    for (const pos of [
        { line: 0, character: 3 },
        { line: 1, character: 8 },
        { line: 1, character: 99 }, // past end of line
        { line: 9, character: 0 }, // past end of document
    ]) {
        assert.deepStrictEqual(completion.contextAt(doc, pos), completion.contextAt(source, pos))
    }
})

test('inStringOrComment detects double quotes, single quotes and comments', () => {
    assert.ok(completion.inStringOrComment({ before: 'label="Kit' }))
    assert.ok(!completion.inStringOrComment({ before: 'label="Kitchen"' }))
    assert.ok(completion.inStringOrComment({ before: "icon='li" }))
    assert.ok(completion.inStringOrComment({ before: '// note about ' }))
    assert.ok(!completion.inStringOrComment({ before: 'Kitchen_Li' }))
})

test('offersItems is true in .items and rule bodies but not in strings', () => {
    assert.ok(completion.offersItems('items', { before: 'Switch ' }))
    assert.ok(completion.offersItems('rules', { before: '    Kitchen_Li' }))
    assert.ok(!completion.offersItems('rules', { before: 'logInfo("' }))
    assert.ok(!completion.offersItems('rules', { before: '// ' }))
})

test('offersItems is scoped to item= and list positions in .sitemap', () => {
    assert.ok(completion.offersItems('sitemap', { before: '        Switch item=' }))
    assert.ok(completion.offersItems('sitemap', { before: 'visibility=[' }))
    assert.ok(!completion.offersItems('sitemap', { before: '        Switch label="' }))
})

test('offersItems stays off for .things and .persist', () => {
    // `.things` never takes item names; `.persist` detection is deferred.
    assert.ok(!completion.offersItems('things', { before: 'Thing ' }))
    assert.ok(!completion.offersItems('persist', { before: '    Kitchen_Li' }))
})

test('isItemTypePosition only fires on the leading token of a .items line', () => {
    assert.ok(completion.isItemTypePosition('items', { before: 'Swi' }))
    assert.ok(completion.isItemTypePosition('items', { before: '    ' }))
    assert.ok(!completion.isItemTypePosition('items', { before: 'Switch Kitchen_' }))
    assert.ok(!completion.isItemTypePosition('rules', { before: 'Swi' }))
})

test('itemCompletions carries name, type and documentation', () => {
    const [entry] = completion.itemCompletions([new Item(rawItem)])
    assert.strictEqual(entry.label, 'Kitchen_Temperature')
    assert.strictEqual(entry.detail, 'Number')
    assert.strictEqual(entry.kind, 6)
    assert.match(entry.documentation, /Kitchen Temperature \[%\.1f °C\]/)
    assert.match(entry.documentation, /State: `21\.5`/)
    assert.match(entry.documentation, /Dimension: Temperature/)
    assert.match(entry.documentation, /Tags: Measurement/)
    assert.match(entry.documentation, /Groups: gWeather/)
})

test('item documentation omits NULL/UNDEF states', () => {
    const nulled = new Item({ ...rawItem, state: 'NULL' })
    assert.ok(!/State:/.test(completion.documentationFor(nulled)))
    const undef = new Item({ ...rawItem, state: 'UNDEF' })
    assert.ok(!/State:/.test(completion.documentationFor(undef)))
})

test('extensionOf extracts the trailing extension case-insensitively', () => {
    assert.strictEqual(extensionOf('file:///cfg/rules/demo.rules'), 'rules')
    assert.strictEqual(extensionOf('/tmp/Demo.ITEMS'), 'items')
    assert.strictEqual(extensionOf('/tmp/README'), '')
})
