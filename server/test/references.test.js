'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
    ReferenceIndex,
    collectSourceFiles,
    findReferencesInFile,
    findReferencesInText,
    findReferencesInWorktree,
    maskStringsAndComments,
} = require('../src/references')

const FIXTURES = path.join(__dirname, '..', '..', 'tests', 'fixtures')

function positions(refs) {
    return refs.map((r) => `${r.range.start.line}:${r.range.start.character}`)
}

test('maskStringsAndComments blanks strings, line and block comments, keeps positions', () => {
    const [masked, inBlock] = maskStringsAndComments('Kitchen_Light.sendCommand(ON) // Kitchen_Light', false)
    assert.strictEqual(masked.slice(0, 13), 'Kitchen_Light')
    assert.strictEqual(masked.includes('sendCommand'), true)
    assert.ok(!masked.includes('//'))
    assert.strictEqual(inBlock, false)

    const [m1, b1] = maskStringsAndComments('/* start Kitchen_Light', false)
    assert.strictEqual(b1, true)
    assert.ok(!m1.includes('Kitchen_Light'))
    const [m2, b2] = maskStringsAndComments('still comment */ Kitchen_Light', b1)
    assert.strictEqual(b2, false)
    assert.strictEqual(m2.slice(-13), 'Kitchen_Light')

    const [m3] = maskStringsAndComments('logInfo("x", "Kitchen_Light") Kitchen_Light', false)
    assert.strictEqual(m3.indexOf('Kitchen_Light'), m3.lastIndexOf('Kitchen_Light'))
    assert.strictEqual(m3.slice(-13), 'Kitchen_Light')
})

test('findReferencesInText finds rule-body and trigger references', () => {
    const rules = [
        'rule "x"',
        'when',
        '    Item Weather_Temperature changed',
        'then',
        '    Weather_Temperature.sendCommand(ON)',
        'end',
    ].join('\n')
    const refs = findReferencesInText(rules, 'Weather_Temperature', { extension: 'rules' })
    assert.deepStrictEqual(positions(refs), ['2:9', '4:4'])
})

test('findReferencesInText excludes strings, comments, and local declarations', () => {
    const rules = [
        'logInfo("light", "Kitchen_Light state")', // string
        '// Kitchen_Light in a comment',
        '/* block comment */ Kitchen_Light.sendCommand(ON)', // after block comment: real ref
        'var Kitchen_Light = 1', // local decl: not a reference
        'Kitchen_Light.sendCommand(OFF)', // real reference
    ].join('\n')
    const refs = findReferencesInText(rules, 'Kitchen_Light', { extension: 'rules' })
    assert.deepStrictEqual(positions(refs), ['2:20', '4:0'])
})

test('findReferencesInText does not match longer names sharing a prefix', () => {
    const refs = findReferencesInText('Kitchen_Light2.sendCommand(ON)\nKitchen_Light.sendCommand(OFF)', 'Kitchen_Light', { extension: 'rules' })
    assert.deepStrictEqual(positions(refs), ['1:0'])
})

test('findReferencesInText excludes the definition itself in .items', () => {
    const items = 'Switch Kitchen_Light "Kitchen" (gLights)\nSwitch Other "o"\n'
    const refs = findReferencesInText(items, 'Kitchen_Light', { extension: 'items' })
    assert.deepStrictEqual(refs, [])
    // But the group reference gLights IS found in the same line's group list.
    const groupRefs = findReferencesInText(items, 'gLights', { extension: 'items' })
    assert.deepStrictEqual(positions(groupRefs), ['0:32'])
})

test('findReferencesInText finds sitemap item= and visibility= references', () => {
    const sitemap = [
        'sitemap demo label="Main"',
        '{',
        '    Switch item=Kitchen_Light label="K [%s]" visibility=[Kitchen_Light==ON]',
        '}',
    ].join('\n')
    const refs = findReferencesInText(sitemap, 'Kitchen_Light', { extension: 'sitemap' })
    assert.deepStrictEqual(positions(refs), ['2:16', '2:57'])
})

test('findReferencesInText excludes persist wildcards but keeps exact names', () => {
    const persist = 'Items {\n    gTemperature* : strategy = everyHour\n    Kitchen_Light : strategy = everyChange\n}\n'
    const wildcard = findReferencesInText(persist, 'gTemperature', { extension: 'persist' })
    assert.deepStrictEqual(wildcard, [])
    const exact = findReferencesInText(persist, 'Kitchen_Light', { extension: 'persist' })
    assert.deepStrictEqual(positions(exact), ['2:4'])
})

test('findReferencesInFile + findReferencesInWorktree over the fixtures', () => {
    // sample.rules references Kitchen_Light, gLights, Weather_Temperature, Astro_Sun_Phase.
    const rulesFile = path.join(FIXTURES, 'sample.rules')
    const refs = findReferencesInFile(rulesFile, 'Kitchen_Light')
    assert.ok(refs.length >= 1)
    assert.ok(refs[0].uri.startsWith('file://'))
    assert.ok(refs[0].uri.endsWith('sample.rules'))

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openhab-refs-'))
    try {
        fs.copyFileSync(path.join(FIXTURES, 'sample.items'), path.join(dir, 'sample.items'))
        fs.copyFileSync(path.join(FIXTURES, 'sample.rules'), path.join(dir, 'sample.rules'))
        fs.copyFileSync(path.join(FIXTURES, 'sample.sitemap'), path.join(dir, 'sample.sitemap'))
        fs.writeFileSync(path.join(dir, 'ignore.txt'), 'Kitchen_Light\n')

        const files = collectSourceFiles(dir).map((f) => path.basename(f)).sort()
        assert.deepStrictEqual(files, ['sample.items', 'sample.rules', 'sample.sitemap'])

        const all = findReferencesInWorktree(dir, 'Kitchen_Light')
        // Definition in sample.items is excluded; references in .rules and .sitemap remain.
        assert.ok(all.length >= 2, `expected references in rules+sitemap, got ${JSON.stringify(all)}`)
        assert.ok(all.every((l) => !l.uri.endsWith('.items')))
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

test('ReferenceIndex scans once and serves findReferences from the cache', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openhab-refs-'))
    try {
        fs.copyFileSync(path.join(FIXTURES, 'sample.items'), path.join(dir, 'sample.items'))
        fs.copyFileSync(path.join(FIXTURES, 'sample.rules'), path.join(dir, 'sample.rules'))
        fs.writeFileSync(path.join(dir, 'ignore.txt'), 'Kitchen_Light\n')

        const index = new ReferenceIndex({ rootDir: dir })
        await index.scanAsync()
        assert.strictEqual(index.size, 2) // .items + .rules, not ignore.txt

        const refs = index.findReferences('Kitchen_Light')
        assert.ok(refs.length >= 1)
        assert.ok(refs.every((l) => l.uri.endsWith('sample.rules')))

        // Cached: deleting the file from disk does not change the result,
        // which proves findReferences does not re-read per request.
        fs.rmSync(path.join(dir, 'sample.rules'))
        assert.strictEqual(index.findReferences('Kitchen_Light').length, refs.length)

        // removeFile drops the cached text; the references disappear.
        index.removeFile(path.join(dir, 'sample.rules'))
        assert.deepStrictEqual(index.findReferences('Kitchen_Light'), [])
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

test('ReferenceIndex.refresh rescans one file when its mtime changed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openhab-refs-'))
    try {
        const rules = path.join(dir, 'x.rules')
        fs.writeFileSync(rules, 'rule "r"\nwhen\n    Item Lamp changed\nthen\nend\n')
        const index = new ReferenceIndex({ rootDir: dir })
        await index.scanAsync()
        assert.strictEqual(index.findReferences('Lamp').length, 1)

        // Same-mtime rewrite: no rescan (pin the mtime inside the tolerance).
        const scanned = fs.statSync(rules).mtimeMs
        fs.writeFileSync(rules, 'rule "r"\nwhen\n    Item Ghost changed\nthen\nend\n')
        const pinned = new Date(scanned + 0.5)
        fs.utimesSync(rules, pinned, pinned)
        assert.strictEqual(index.refresh(rules), false)
        assert.strictEqual(index.findReferences('Lamp').length, 1)

        // Clearly newer mtime: the rescan replaces the cached text.
        const later = new Date(scanned + 5000)
        fs.utimesSync(rules, later, later)
        assert.strictEqual(index.refresh(rules), true)
        assert.strictEqual(index.findReferences('Lamp').length, 0)
        assert.strictEqual(index.findReferences('Ghost').length, 1)

        // Non-source extensions are never cached.
        fs.writeFileSync(path.join(dir, 'notes.txt'), 'Lamp\n')
        assert.strictEqual(index.refresh(path.join(dir, 'notes.txt')), false)
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

test('ReferenceIndex.findReferences reads extraFiles outside the cache fresh, deduplicated', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openhab-refs-'))
    try {
        fs.copyFileSync(path.join(FIXTURES, 'sample.items'), path.join(dir, 'sample.items'))
        const outside = path.join(os.tmpdir(), 'openhab-refs-extra', 'extra.rules')
        fs.mkdirSync(path.dirname(outside), { recursive: true })
        fs.writeFileSync(outside, 'rule "e"\nwhen\n    Item Kitchen_Light changed\nthen\nend\n')

        const index = new ReferenceIndex({ rootDir: dir })
        await index.scanAsync()

        // The extra file (outside the scanned root) is read from disk;
        // duplicated entries and files already in the cache are deduplicated.
        const refs = index.findReferences('Kitchen_Light', {
            extraFiles: [outside, outside, path.join(dir, 'sample.items')],
        })
        assert.strictEqual(refs.length, 1)
        assert.ok(refs[0].uri.endsWith('extra.rules'))
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
        fs.rmSync(path.join(os.tmpdir(), 'openhab-refs-extra'), { recursive: true, force: true })
    }
})
