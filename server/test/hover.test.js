'use strict'

const test = require('node:test')
const assert = require('node:assert')

const Item = require('../src/Item')
const hover = require('../src/hover')
const { TextDocument } = require('vscode-languageserver-textdocument')

const rawItem = {
    name: 'Kitchen_Light',
    type: 'Switch',
    label: 'Kitchen Light',
    state: 'ON',
    tags: ['Lighting'],
    groupNames: ['gLights'],
}

test('wordAt extracts the identifier under the cursor', () => {
    const src = '    Kitchen_Light.sendCommand(OFF)\n'
    assert.strictEqual(hover.wordAt(src, { line: 0, character: 8 }), 'Kitchen_Light')
    assert.strictEqual(hover.wordAt(src, { line: 0, character: 15 }), 'Kitchen_Light')
    assert.strictEqual(hover.wordAt(src, { line: 0, character: 20 }), 'sendCommand')
})

test('wordAt keeps $ in names and stops at punctuation', () => {
    const src = 'val x$1 = Kitchen_Light\n'
    assert.strictEqual(hover.wordAt(src, { line: 0, character: 4 }), 'x$1')
    assert.strictEqual(hover.wordAt(src, { line: 0, character: 20 }), 'Kitchen_Light')
    assert.strictEqual(hover.wordAt(src, { line: 0, character: 0 }), 'val')
})

test('wordAt returns null on whitespace and past end of line', () => {
    // cursor inside a run of spaces: both neighbours are non-word chars
    assert.strictEqual(hover.wordAt('ab  cd', { line: 0, character: 3 }), null)
    assert.strictEqual(hover.wordAt('a b', { line: 5, character: 0 }), null)
    // past end of line clamps to the last word
    assert.strictEqual(hover.wordAt('a b', { line: 0, character: 99 }), 'b')
})

test('wordAt/wordRangeAt accept a TextDocument and match the plain-string form', () => {
    const src = 'val x = Kitchen_Light.state\n'
    const doc = TextDocument.create('file:///x.rules', 'openhab', 1, src)
    for (const pos of [
        { line: 0, character: 12 },
        { line: 0, character: 22 },
        { line: 0, character: 0 },
        { line: 7, character: 0 },
    ]) {
        assert.strictEqual(hover.wordAt(doc, pos), hover.wordAt(src, pos))
        assert.deepStrictEqual(hover.wordRangeAt(doc, pos), hover.wordRangeAt(src, pos))
    }
    assert.strictEqual(hover.wordAt(doc, { line: 0, character: 12 }), 'Kitchen_Light')
})

test('hoverFor shows only the live state as markdown', () => {
    const h = hover.hoverFor(new Item(rawItem))
    assert.strictEqual(h.contents.kind, 'markdown')
    assert.strictEqual(h.contents.value, 'State: `ON`')
})

test('hoverFor shows a placeholder when the item has no state yet', () => {
    const h = hover.hoverFor(new Item({ ...rawItem, state: 'NULL' }))
    assert.strictEqual(h.contents.value, 'State: _(none yet)_')
})
