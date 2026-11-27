'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { findItemOccurrences } = require('../src/itemOccurrences')

function positions(results) {
    return results.map((r) => `${r.name}@${r.range.start.line}:${r.range.start.character}`)
}

test('rules: trigger, member access, and Member of are found; strings/comments/locals excluded', () => {
    const rules = [
        'rule "x"',
        'when',
        '    Item Kitchen_Light changed',
        '    Member of (gLights) changed',
        'then',
        '    Kitchen_Light.sendCommand(ON)',
        '    logInfo("x", "Kitchen_Light")', // string: masked
        '    // Kitchen_Light', // comment: masked
        '    val Shadowed = 1', // local decl …
        '    Shadowed.postUpdate(OFF)', // … member access on the local: excluded
        '    Other_Item.postUpdate(OFF)',
        'end',
    ].join('\n')
    const found = findItemOccurrences(rules, 'rules')
    assert.deepStrictEqual(positions(found), [
        'Kitchen_Light@2:9',
        'gLights@3:15',
        'Kitchen_Light@5:4',
        'Other_Item@10:4',
    ])
    assert.ok(found.every((f) => !f.isDefinition))
})

test('items: definition name is flagged isDefinition; group list is not; type-chain parens skipped', () => {
    const items = [
        'Group:Contact:OR(OPEN, CLOSED) gWindowsensors "…" (gAll, gLights)',
        'Switch Kitchen_Light "K" <light> (gLights)',
        '// Switch Ghost "x" (gAll)', // comment line: no candidates
    ].join('\n')
    const found = findItemOccurrences(items, 'items')
    assert.deepStrictEqual(positions(found), [
        'gWindowsensors@0:31',
        'gAll@0:51',
        'gLights@0:57',
        'Kitchen_Light@1:7',
        'gLights@1:34',
    ])
    assert.deepStrictEqual(found.map((f) => f.isDefinition), [true, false, false, true, false])
})

test('sitemap: item= and visibility= references', () => {
    const sitemap = [
        'sitemap demo label="Main"',
        '{',
        '    Switch item=Kitchen_Light label="K" visibility=[Kitchen_Light==ON, Other==OFF]',
        '}',
    ].join('\n')
    const found = findItemOccurrences(sitemap, 'sitemap')
    assert.deepStrictEqual(positions(found), [
        'Kitchen_Light@2:16',
        'Kitchen_Light@2:52',
        'Other@2:71',
    ])
})

test('persist: exact names in Items block only; wildcards and Strategies skipped', () => {
    const persist = [
        'Strategies {',
        '    everyHour : "0 0 * * * ?"',
        '}',
        'Items {',
        '    gTemperature* : strategy = everyHour',
        '    Kitchen_Light : strategy = everyChange',
        '}',
    ].join('\n')
    const found = findItemOccurrences(persist, 'persist')
    assert.deepStrictEqual(positions(found), ['Kitchen_Light@5:4'])
})

test('things and unknown extensions yield nothing', () => {
    assert.deepStrictEqual(findItemOccurrences('Thing hue:0210 "X" [ Kitchen_Light ]\n', 'things'), [])
    assert.deepStrictEqual(findItemOccurrences('Kitchen_Light.sendCommand(ON)\n', 'txt'), [])
})

test('prefix-sharing names are matched as whole words only', () => {
    const rules = 'Kitchen_Light2.sendCommand(ON)\nKitchen_Light.sendCommand(OFF)\n'
    const found = findItemOccurrences(rules, 'rules')
    assert.deepStrictEqual(positions(found), ['Kitchen_Light2@0:0', 'Kitchen_Light@1:0'])
})
