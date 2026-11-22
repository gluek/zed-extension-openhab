'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { contextAt } = require('../src/completion')
const {
    OH_ICONS,
    SEMANTIC_TAGS,
    isIconPosition,
    isTagPosition,
    iconCompletions,
    tagCompletions,
} = require('../src/icons')

test('isIconPosition fires inside an unclosed <…> on an .items line', () => {
    const line = 'Switch Kitchen_Light "Kitchen" <li'
    const ctx = contextAt(line, { line: 0, character: line.length })
    assert.strictEqual(isIconPosition('items', ctx), true)
    // Not in other files, not inside the label string, not after a closed tag.
    assert.strictEqual(isIconPosition('rules', ctx), false)
    assert.strictEqual(isIconPosition('items', contextAt('Switch X "<not icon', { line: 0, character: 13 })), false)
    assert.strictEqual(isIconPosition('items', contextAt('Switch X "l" <light> ', { line: 0, character: 21 })), false)
    // The label is optional in openHAB: `Switch X <li` (no label) is an icon position too.
    assert.strictEqual(isIconPosition('items', contextAt('Switch X <li', { line: 0, character: 12 })), true)
    assert.strictEqual(isIconPosition('items', contextAt('Switch X <', { line: 0, character: 10 })), true)
    // Group type chain + icon: `Group:Number:AVG g <te`.
    assert.strictEqual(isIconPosition('items', contextAt('Group:Number:AVG g <te', { line: 0, character: 21 })), true)
    // Iconify prefixes inside <…>: `<mdi:li`.
    assert.strictEqual(isIconPosition('items', contextAt('Switch X "L" <mdi:li', { line: 0, character: 20 })), true)
})

test('isIconPosition stays false outside the icon clause', () => {
    // sitemap-widget-shaped line is not an .items definition with an icon clause
    assert.strictEqual(isIconPosition('items', contextAt('Switch item=X', { line: 0, character: 13 })), false)
    // after a closed icon and a space there is no open clause
    assert.strictEqual(isIconPosition('items', contextAt('Switch X "l" <light> ', { line: 0, character: 21 })), false)
})

test('isTagPosition fires inside a quoted string of the […] tag list only', () => {
    const tagLine = 'Switch X "label" <light> ["Ligh'
    assert.strictEqual(isTagPosition('items', contextAt(tagLine, { line: 0, character: tagLine.length })), true)
    // The label string itself is NOT a tag position (no [ before the quote).
    assert.strictEqual(isTagPosition('items', contextAt('Switch X "Lab', { line: 0, character: 12 })), false)
    // Location config [ latitude="…" ] is not a tag list (the `=` excludes it).
    assert.strictEqual(isTagPosition('items', contextAt('Location X "l" [ latitude="5', { line: 0, character: 29 })), false)
    // A bare [ without a label string before it IS a tag list (label optional).
    assert.strictEqual(isTagPosition('items', contextAt('Switch X ["Foo', { line: 0, character: 14 })), true)
    // Tag list after a closed icon and a group list: `… <light> (gAll) ["Mea`.
    assert.strictEqual(
        isTagPosition('items', contextAt('Switch X "L" <light> (gAll) ["Mea', { line: 0, character: 33 })),
        true,
    )
    // Tag list right after a closed icon: `… <light> ["Li`.
    assert.strictEqual(
        isTagPosition('items', contextAt('Switch X "L" <light> ["Li', { line: 0, character: 25 })),
        true,
    )
    // After a comma inside the list: next tag.
    const listLine = 'Switch X "l" ["Lighting", "Gro'
    assert.strictEqual(isTagPosition('items', contextAt(listLine, { line: 0, character: listLine.length })), true)
    // Not in .rules.
    assert.strictEqual(isTagPosition('rules', contextAt('["Foo', { line: 0, character: 5 })), false)
})

test('iconCompletions filters the OH icon set by prefix and adds iconify prefixes', () => {
    const light = iconCompletions('li')
    assert.ok(light.some((i) => i.label === 'light'))
    assert.ok(light.some((i) => i.label === 'lightbulb'))
    assert.ok(!light.some((i) => i.label === 'door'))
    const md = iconCompletions('md')
    assert.ok(md.some((i) => i.label === 'mdi:'))
    // Empty partial returns the whole classic set.
    assert.ok(iconCompletions('').length >= OH_ICONS.length)
})

test('tagCompletions filters ontology tags and merges extra (project-local) tags first', () => {
    const t = tagCompletions('Li')
    const labels = t.map((i) => i.label)
    assert.ok(labels.includes('Lighting') === false) // not in ontology list
    assert.ok(labels.includes('Light'))
    const merged = tagCompletions('', ['MyCustomTag', 'Lighting'])
    assert.strictEqual(merged[0].label, 'MyCustomTag') // extras first
    assert.ok(merged.some((i) => i.label === 'Lighting'))
    assert.ok(merged.some((i) => i.label === 'Equipment'))
    // Dedup: extra tag equal to an ontology tag appears once.
    const dedup = tagCompletions('', ['Light'])
    assert.strictEqual(dedup.filter((i) => i.label === 'Light').length, 1)
})

test('the bundled lists are non-trivial and contain the canonical entries', () => {
    for (const icon of ['light', 'temperature', 'door', 'rollershutter']) {
        assert.ok(OH_ICONS.includes(icon), `missing icon ${icon}`)
    }
    for (const tag of ['Equipment', 'Point', 'Property', 'Location', 'Room', 'Measurement', 'Setpoint', 'Control', 'Temperature', 'Lightbulb', 'Sensor', 'HVAC']) {
        assert.ok(SEMANTIC_TAGS.includes(tag), `missing tag ${tag}`)
    }
})
