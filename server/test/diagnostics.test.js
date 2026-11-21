'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { findUnknownItemRefs, findUnknownTags } = require('../src/diagnostics')

const KNOWN = new Set(['Kitchen_Light', 'gLights', 'Weather_Temperature', 'gAll'])
const isKnown = (name) => KNOWN.has(name)

function positions(results) {
    return results.map((r) => `${r.range.start.line}:${r.range.start.character}`)
}

test('flags an unknown item in a rule trigger and in a member access', () => {
    const rules = [
        'rule "x"',
        'when',
        '    Item Kitchen_Lght changed',
        '    Item Weather_Temperature changed',
        'then',
        '    Kitchen_Lght.sendCommand(ON)',
        'end',
    ].join('\n')
    const found = findUnknownItemRefs(rules, 'rules', isKnown)
    assert.deepStrictEqual(positions(found), ['2:9', '5:4'])
    assert.ok(found.every((f) => f.name === 'Kitchen_Lght'))
    assert.ok(found[0].message.includes("Unknown item 'Kitchen_Lght'"))
})

test('flags an unknown group in a Member of trigger', () => {
    const rules = 'when\n    Member of (gLightz) changed\nthen\nend\n'
    const found = findUnknownItemRefs(rules, 'rules', isKnown)
    assert.deepStrictEqual(positions(found), ['1:15'])
})

test('does not flag strings, comments, or val/var locals in rules', () => {
    const rules = [
        'logInfo("x", "Kitchen_Lght")', // string: masked
        '// Kitchen_Lght', // line comment: masked
        '/* block */ Unknown_Item.sendCommand(ON)', // after block comment: real ref
        'val Shadowed = 1', // local decl …
        'Shadowed.postUpdate(OFF)', // … member access on the local: excluded
    ].join('\n')
    const found = findUnknownItemRefs(rules, 'rules', isKnown)
    assert.deepStrictEqual(positions(found), ['2:12'])
    assert.strictEqual(found[0].name, 'Unknown_Item')
})

test('flags unknown items in sitemap item= and visibility=', () => {
    const sitemap = [
        'sitemap demo label="Main"',
        '{',
        '    Switch item=Kitchen_Lght label="K" visibility=[Kitchen_Light==ON, Unknown==OFF]',
        '}',
    ].join('\n')
    const found = findUnknownItemRefs(sitemap, 'sitemap', isKnown)
    // Kitchen_Light is known (not flagged); Kitchen_Lght (item=) and Unknown (visibility) are flagged.
    assert.deepStrictEqual(positions(found), ['2:16', '2:70'])
    assert.deepStrictEqual(found.map((f) => f.name), ['Kitchen_Lght', 'Unknown'])
})

test('flags unknown group names in .items group lists, but not the type chain', () => {
    const items = [
        'Group:Contact:OR(OPEN, CLOSED) gWindowsensors "…" (gAll, gUnknownGroup)',
        'Switch Kitchen_Light "K" (gLights)',
    ].join('\n')
    const found = findUnknownItemRefs(items, 'items', isKnown)
    // Only gUnknownGroup; OPEN/CLOSED are inside the type chain (before the
    // definition name), gAll/gLights are known.
    assert.deepStrictEqual(positions(found), ['0:57'])
    assert.strictEqual(found[0].name, 'gUnknownGroup')
})

test('flags exact unknown names in a persist Items block, skips wildcards and Strategies', () => {
    const persist = [
        'Strategies {',
        '    everyHour : "cron"',
        '}',
        'Items {',
        '    gTemperature* : strategy = everyHour',
        '    Kitchen_Lght : strategy = everyChange',
        '    Kitchen_Light : strategy = everyChange',
        '}',
    ].join('\n')
    const found = findUnknownItemRefs(persist, 'persist', isKnown)
    assert.deepStrictEqual(positions(found), ['5:4'])
    assert.strictEqual(found[0].name, 'Kitchen_Lght')
})

test('.things files and non-openhab extensions produce no diagnostics', () => {
    const things = 'Thing hue:0210:1:bulb1 "Bulb" [ Kitchen_Lght ]\n'
    assert.deepStrictEqual(findUnknownItemRefs(things, 'things', isKnown), [])
    assert.deepStrictEqual(findUnknownItemRefs('Kitchen_Lght', 'txt', isKnown), [])
})

test('a longer item name sharing a prefix is not flagged when only the prefix is unknown', () => {
    const rules = 'when\n    Item Kitchen_Light changed\nthen\nend\n'
    // Kitchen_Light is known; make the *longer* name known too and check the
    // trigger regex does not capture only a prefix.
    const known = new Set(['Kitchen_Light2'])
    const found = findUnknownItemRefs(rules, 'rules', (n) => known.has(n))
    // Kitchen_Light (the exact trigger word) is NOT known here -> flagged once.
    assert.deepStrictEqual(positions(found), ['1:9'])
    assert.strictEqual(found[0].name, 'Kitchen_Light')
})

test('findUnknownTags flags non-ontology tags, keeps ontology and project tags', () => {
    const items = [
        'Switch A "a" <light> ["Lighting", "GroundFloor", "MyCustomTag"]',
        'Switch B "b" ["Point", "Measurement"]',
        '// Switch C "c" ["GhostTag"]', // comment line: skipped
    ].join('\n')
    const projectTags = new Set(['Lighting', 'GroundFloor'])
    const found = findUnknownTags(items, (t) => projectTags.has(t))
    assert.deepStrictEqual(positions(found), ['0:50'])
    assert.strictEqual(found[0].name, 'MyCustomTag')
    assert.ok(found[0].message.includes("Unknown semantic tag 'MyCustomTag'"))
})

test('findUnknownTags ignores Location config and the label string', () => {
    const items = 'Location Home "Home" [ latitude="52.5", longitude="13.4" ]\nSwitch X "Taggy" ["Light"]\n'
    const found = findUnknownTags(items, () => false)
    // latitude/longitude are config keys, not tags; "Taggy" is the label;
    // "Light" is in the ontology.
    assert.deepStrictEqual(found, [])
})

test('findUnknownTags accepts live-instance tags via isKnownTag', () => {
    const items = 'Switch A "a" ["VendorTag"]\n'
    assert.deepStrictEqual(findUnknownTags(items, (t) => t === 'VendorTag'), [])
    assert.strictEqual(findUnknownTags(items, () => false).length, 1)
})

test('findUnknownTags passes the match position so the caller can exclude the same line', () => {
    // A tag used only on its own line is not "project-established".
    const items = 'Switch A "a" ["LonelyTag"]\nSwitch B "b" ["SharedTag"]\nSwitch C "c" ["SharedTag"]\n'
    const seen = []
    const usageLines = { LonelyTag: [0], SharedTag: [1, 2] }
    const isKnown = (tag, pos) => {
        seen.push([tag, pos])
        // Project-known only if the tag appears on a DIFFERENT line.
        return (usageLines[tag] || []).some((l) => l !== pos.line)
    }
    const found = findUnknownTags(items, isKnown)
    assert.deepStrictEqual(positions(found), ['0:15'])
    assert.strictEqual(found[0].name, 'LonelyTag')
    // All callbacks received a {line, character} position.
    assert.ok(seen.length === 3)
    assert.ok(seen.every(([, pos]) => typeof pos.line === 'number' && typeof pos.character === 'number'))
})
