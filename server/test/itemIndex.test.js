'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
    ItemIndex,
    collectItemsFiles,
    parseDefinitionLine,
    parseItemsFile,
    NAME_RE,
} = require('../src/itemIndex')

const FIXTURES = path.join(__dirname, '..', '..', 'tests', 'fixtures')

test('parseDefinitionLine extracts the name and its range', () => {
    const def = parseDefinitionLine('Switch Kitchen_Light "Kitchen Light" <light> (gLights)', 3)
    assert.strictEqual(def.name, 'Kitchen_Light')
    assert.deepStrictEqual(def.range, {
        start: { line: 3, character: 7 },
        end: { line: 3, character: 7 + 'Kitchen_Light'.length },
    })
})

test('parseDefinitionLine handles unit and aggregation type chains', () => {
    assert.strictEqual(parseDefinitionLine('Group:Number:AVG gTemperature "x"', 0).name, 'gTemperature')
    assert.strictEqual(
        parseDefinitionLine('Group:Contact:OR(OPEN, CLOSED) gWindowsensors "Fenster"', 4).name,
        'gWindowsensors',
    )
    assert.strictEqual(parseDefinitionLine('Number:Temperature Outdoor "…"', 0).name, 'Outdoor')
})

test('parseDefinitionLine rejects comments, non-definitions, and sitemap widgets', () => {
    assert.strictEqual(parseDefinitionLine('// Switch Ghost "x"', 0), null)
    assert.strictEqual(parseDefinitionLine('    channel="hue:…"', 1), null)
    assert.strictEqual(parseDefinitionLine('', 0), null)
    // A sitemap widget line (`Switch item=X`) must NOT be a definition: the
    // token after the type word is `item`, but it is followed by `=`, and the
    // regex requires whitespace then an identifier — `item=X` has no space,
    // so the match fails. Assert explicitly:
    assert.strictEqual(parseDefinitionLine('        Switch item=Kitchen_Light label="x"', 5), null)
})

test('parseItemsFile parses sample.items into the 10 expected names', () => {
    const text = fs.readFileSync(path.join(FIXTURES, 'sample.items'), 'utf8')
    const names = parseItemsFile(text).map((d) => d.name)
    assert.deepStrictEqual(names, [
        'gLights',
        'gTemperature',
        'Kitchen_Light',
        'Livingroom_Dimmer',
        'Bedroom_Color',
        'Weather_Temperature',
        'Last_Update',
        'Persistence_Service',
        'Roller_Shutter',
        'Front_Door',
    ])
})

test('parseItemsFile handles real-syntax items (aggregation functions, multi-line metadata)', () => {
    const text = fs.readFileSync(path.join(FIXTURES, 'items-real.items'), 'utf8')
    const names = parseItemsFile(text).map((d) => d.name)
    assert.deepStrictEqual(names, [
        'gWindowsensors',
        'gTemperatures',
        'gAll',
        'Kitchen_Light',
        'Outdoor',
        'Front_Door',
        'Garage',
    ])
})

test('parseItemsFile on items-edge.items finds every base type definition', () => {
    const text = fs.readFileSync(path.join(FIXTURES, 'items-edge.items'), 'utf8')
    const names = parseItemsFile(text).map((d) => d.name)
    for (const expected of ['gAll', 'gLights', 'gWeather', 'gTemperature', 'gEnergy', 'Kitchen_Color', 'Kitchen_Power', 'Main_Switch']) {
        assert.ok(names.includes(expected), `expected ${expected} in ${names}`)
    }
})

test('ItemIndex scans a temp worktree and resolves definitions as file URIs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openhab-index-'))
    try {
        fs.writeFileSync(
            path.join(dir, 'lamps.items'),
            'Switch Kitchen_Light "Kitchen Light" <light>\nGroup gLights "All"\n',
        )
        fs.mkdirSync(path.join(dir, 'node_modules'))
        fs.writeFileSync(path.join(dir, 'node_modules', 'ignored.items'), 'Switch Ghost "x"\n')
        fs.writeFileSync(path.join(dir, 'notes.txt'), 'Switch NotAnItem "x"\n')

        const index = new ItemIndex({ rootDir: dir })
        index.scan()
        assert.strictEqual(index.size, 2)

        const def = index.get('Kitchen_Light')
        assert.ok(def.uri.startsWith('file://'))
        assert.ok(def.uri.endsWith('lamps.items'))
        assert.deepStrictEqual(def.range.start, { line: 0, character: 7 })
        assert.strictEqual(index.get('Ghost'), null)
        assert.strictEqual(index.has('gLights'), true)
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

test('ItemIndex.refresh picks up edits only when mtime changes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openhab-index-'))
    try {
        const file = path.join(dir, 'a.items')
        fs.writeFileSync(file, 'Switch One "1"\n')
        const index = new ItemIndex({ rootDir: dir })
        index.scan()
        assert.strictEqual(index.get('One').range.start.character, 7)

        // Same content mtime: no rescan. writeFileSync bumps the mtime, so
        // pin it back to the value recorded at scan time (with a small delta
        // to stay inside the 2 ms tolerance used by scanFile).
        const scanned = fs.statSync(file).mtimeMs
        fs.writeFileSync(file, 'Switch Two "2"\n')
        const pinned = new Date(scanned + 0.5)
        fs.utimesSync(file, pinned, pinned)
        assert.strictEqual(index.refresh(file), false)
        assert.ok(index.has('One'))

        // Force a clearly newer mtime: rescan replaces the definition.
        const later = new Date(scanned + 5000)
        fs.utimesSync(file, later, later)
        assert.strictEqual(index.refresh(file), true)
        assert.strictEqual(index.has('One'), false)
        assert.strictEqual(index.has('Two'), true)
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

test('collectItemsFiles is sorted and skips junk directories', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openhab-index-'))
    try {
        fs.mkdirSync(path.join(dir, '.git'))
        fs.writeFileSync(path.join(dir, '.git', 'x.items'), 'Switch G "g"\n')
        fs.writeFileSync(path.join(dir, 'b.items'), 'Switch B "b"\n')
        fs.writeFileSync(path.join(dir, 'a.items'), 'Switch A "a"\n')
        const files = collectItemsFiles(dir).map((f) => path.basename(f))
        assert.deepStrictEqual(files, ['a.items', 'b.items'])
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

test('NAME_RE accepts openHAB names and rejects invalid rename targets', () => {
    assert.ok(NAME_RE.test('Kitchen_Light'))
    assert.ok(NAME_RE.test('_x9'))
    assert.ok(!NAME_RE.test('9x'))
    assert.ok(!NAME_RE.test('a-b'))
    assert.ok(!NAME_RE.test('a b'))
})
