/**
 * Pure line-level parsers for openHAB files: `.items` definition lines and
 * `[“…”]` tag lists. Shared by the item index (`itemIndex.js`), the occurrence
 * scanner (`itemOccurrences.js`), and the reference finder (`references.js`).
 *
 * Everything here is synchronous string -> data with no `fs` and no imports.
 * These lived in `itemIndex.js` (definitions) and `itemOccurrences.js` (tag
 * lists); both now also need *each other's* parsers — the index extracts tags
 * during its scan — so the shared pieces moved here to keep the dependency
 * graph acyclic.
 */
'use strict'

/**
 * The grammar's `dsl_type_word` list (grammar/grammar.js): the 12 base item
 * types plus the extra `.items` types (`Call`, `StringList`, `QuantityType`)
 * and the sitemap widget words (`Default`, `Slider`, `Chart`, …) — one token
 * serves both dialects, so the definition-line matcher accepts all of them.
 * (`completion.js` offers only the 12 base item types to users.)
 */
const ITEM_TYPES = [
    'Color', 'Contact', 'DateTime', 'Dimmer', 'Group', 'Image', 'Location',
    'Number', 'Player', 'Rollershutter', 'String', 'Switch', 'Call',
    'StringList', 'QuantityType',
    'Default', 'Selection', 'Setpoint', 'Slider', 'Colorpicker',
    'Chart', 'Webview', 'Video', 'Mapview',
]

/**
 * An item definition line looks like:
 *   Switch Kitchen_Light "Kitchen Light" <light> (gLights) { … }
 *   Group:Number:AVG gTemperature "…"
 *   Group:Contact:OR(OPEN, CLOSED) gWindowsensors "…"
 * The name is the first identifier after the type chain (type + `:…` segments,
 * where a segment may be `Unit`, `AVG`, or `OR(OPEN, CLOSED)`).
 */
const DEFINITION_RE = new RegExp(
    // The trailing `(?!\w|=)` keeps a sitemap widget line (`Switch item=X …`)
    // from matching: `item` must be a standalone name token, not a keyword
    // glued to `=X`.
    `^\\s*(?:${ITEM_TYPES.join('|')})(?::[A-Za-z_]\\w*(?:\\([^)]*\\))?)*\\s+([A-Za-z_]\\w*)(?!\\w|=)`,
)

/** Item name token: openHAB names are `[A-Za-z_][A-Za-z0-9_]*`. */
const NAME_RE = /^[A-Za-z_]\w*$/

/**
 * Parse one line of a `.items` file.
 *
 * @param {string} line
 * @param {number} lineNumber 0-based
 * @returns {{name: string, range: {start: {line: number, character: number}, end: {line: number, character: number}}} | null}
 */
function parseDefinitionLine(line, lineNumber) {
    // A definition never starts inside a comment; `//` before the type word
    // means the line is a comment.
    const match = DEFINITION_RE.exec(line)
    if (!match) {
        return null
    }
    const name = match[1]
    const start = match.index + match[0].indexOf(name)
    return {
        name,
        range: {
            start: { line: lineNumber, character: start },
            end: { line: lineNumber, character: start + name.length },
        },
    }
}

/**
 * Parse all definitions in a `.items` file's text.
 *
 * @param {string} text
 * @returns {Array<{name: string, range: object}>}
 */
function parseItemsFile(text) {
    const definitions = []
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
        // Skip comment lines (the regex would not match them anyway, since a
        // comment starts with `//`, but being explicit avoids surprises with
        // `// Switch X` lines).
        if (lines[i].trimStart().startsWith('//')) {
            continue
        }
        const def = parseDefinitionLine(lines[i], i)
        if (def) {
            definitions.push(def)
        }
    }
    return definitions
}

/**
 * The tag list of an `.items` definition line: a `["…", …]` bracket that
 * follows the label string (and optional `<icon>`). Location config
 * (`[ latitude=… ]`) contains `=` and is not a tag list.
 */
const TAG_LIST_LINE_RE = /"[^"]*"(?:\s*<[^>]*>)?\s*\[([^\]]*)\]/g

/** One quoted value inside a tag list. */
const TAG_VALUE_RE = /"([^"]*)"|'([^']*)'/g

/**
 * The quoted values of every tag list on `line`.
 *
 * @param {string} line raw line (offsets must stay true to the document)
 * @returns {Array<{tag: string, character: number, bracket: number}>}
 *   `character` is the opening quote of the value, `bracket` the `[` — pass
 *   the masked line at `bracket` to test whether the list sits inside a
 *   string/comment.
 */
function tagListValues(line) {
    const out = []
    TAG_LIST_LINE_RE.lastIndex = 0
    let m
    while ((m = TAG_LIST_LINE_RE.exec(line)) !== null) {
        if (m[0].includes('=')) {
            continue // Location config, not tags
        }
        const bracket = m.index + m[0].indexOf('[')
        const bracketStart = bracket + 1
        TAG_VALUE_RE.lastIndex = 0
        let v
        while ((v = TAG_VALUE_RE.exec(m[1])) !== null) {
            const tag = v[1] ?? v[2]
            if (tag) {
                out.push({ tag, character: bracketStart + v.index + 1, bracket })
            }
        }
    }
    return out
}

module.exports = { ITEM_TYPES, NAME_RE, parseDefinitionLine, parseItemsFile, tagListValues }
