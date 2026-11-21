/**
 * Unknown-item diagnostics: flag item-name references that exist neither in
 * the worktree `.items` index nor in the live openHAB item cache.
 *
 * Candidate positions are per file type, chosen to be low-noise:
 *  - `.rules` / `.script`: rule triggers (`Item X changed`,
 *    `Member of (X) …`) and member accesses (`X.state`, `X.sendCommand(…)`,
 *    `X.postUpdate(…)`, `X.members`, `X.lastState`).
 *  - `.items`: names in group lists `(gAll, gLights)` on definition lines.
 *    Parens before the definition name are the type chain (`OR(OPEN, CLOSED)`)
 *    and are skipped.
 *  - `.sitemap`: `item=X` bindings and `visibility=[X==ON, Y!=OFF]` conditions.
 *  - `.persist`: exact names inside the `Items { … }` block only (wildcards
 *    `gTemperature*` / `*` are skipped, and `Strategies { … }` blocks are
 *    ignored).
 *
 * Strings and comments are masked first (reusing references.js), and
 * `val|var X = …` locals are excluded.
 */
'use strict'

const { maskStringsAndComments } = require('./references')
const { parseDefinitionLine } = require('./itemIndex')

/** Member accesses that only make sense on items. Group 2 = the trailing `.member`. */
const ITEM_MEMBER_RE = /([A-Za-z_]\w*)(\.(?:state|sendCommand|postUpdate|members|lastState)\b)/g

/** `Item X changed` / `Item X received update …` / `Item X received command …` trigger. */
const ITEM_TRIGGER_RE = /(?:^|[^A-Za-z0-9_$])Item\s+([A-Za-z_]\w*)/g

/** `Member of (X) …` trigger. Group 2 = the trailing `)`. */
const MEMBER_OF_RE = /Member\s+of\s*\(\s*([A-Za-z_]\w*)(\s*\))/g

/** `item=X` in a sitemap widget. */
const SITEMAP_ITEM_RE = /\bitem\s*=\s*([A-Za-z_]\w*)/g

/** `visibility=[X==ON, Y!=OFF]` condition items. Group 2 = the operator. */
const VISIBILITY_RE = /(?:\[|,)\s*([A-Za-z_]\w*)\s*(==|!=)/g

/** Group list `(a, b)` on an .items definition line. */
const GROUP_LIST_RE = /\(([^()]*)\)/g

/** The `Items { … }` block of a .persist file (no nested braces inside). */
const PERSIST_ITEMS_BLOCK_RE = /\bItems\s*\{([^{}]*)\}/g

/** Persist entry name inside an Items block: after `{`, `,`, or a newline. Group 2 = optional `*`. */
const PERSIST_NAME_RE = /(?:^|[{,]\s*|\n\s*)([A-Za-z_]\w*)(\*?)/g

/** Local variable declaration in a rule body: `val X = …` / `var X = …`. */
const LOCAL_DECL_RE = /(?:^|[^A-Za-z0-9_$])(?:val|var)\s+([A-Za-z_]\w*)\s*=/g

const NAME_TOKEN_RE = /^[A-Za-z_]\w*$/

/**
 * Push `{name, index}` for every match of `re` in `masked`. `index` is the
 * absolute start offset of the captured name (group 1); all later groups are
 * trailing tokens whose length is subtracted from the offset math. Matches
 * whose group 2 is `*` (persist wildcards) are skipped. `accept(index)` can
 * veto a match (used to restrict persist names to the Items block).
 */
function collectMatches(re, masked, into, accept) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(masked)) !== null) {
        if (m[2] === '*') {
            continue
        }
        let trailing = 0
        for (let i = 2; i < m.length; i++) {
            trailing += (m[i] || '').length
        }
        const start = m.index + m[0].length - m[1].length - trailing
        if (accept && !accept(start)) {
            continue
        }
        into.push({ name: m[1], index: start })
    }
}

/**
 * All unknown-item reference ranges in a document.
 *
 * @param {string} text full document text
 * @param {string} extension file extension without dot
 * @param {(name: string) => boolean} isKnown item exists (index ∪ live cache)
 * @returns {Array<{range: object, name: string, message: string}>}
 */
function findUnknownItemRefs(text, extension, isKnown) {
    const lines = text.split(/\r?\n/)
    // Character offset of each line start in the re-joined masked text
    // (lines joined with a single '\n', so offsets are internally consistent
    // even for CRLF input — the '\r' only ever sits at a line end).
    const lineOffsets = []
    let offset = 0
    for (const line of lines) {
        lineOffsets.push(offset)
        offset += line.length + 1
    }
    const maskedLines = []
    let inBlock = false
    for (const line of lines) {
        const [masked, next] = maskStringsAndComments(line, inBlock)
        inBlock = next
        maskedLines.push(masked)
    }
    const maskedWhole = maskedLines.join('\n')

    const toRange = (index, name) => {
        let line = 0
        while (line + 1 < lineOffsets.length && lineOffsets[line + 1] <= index) {
            line += 1
        }
        const character = index - lineOffsets[line]
        return {
            range: {
                start: { line, character },
                end: { line, character: character + name.length },
            },
            name,
            message: `Unknown item '${name}' (not defined in any .items file and not present on the openHAB instance)`,
        }
    }

    /** @type {Array<{name: string, index: number}>} */
    const candidates = []

    if (extension === 'items') {
        // Group-list names on definition lines. Parens before the definition
        // name belong to the type chain (`Group:Contact:OR(OPEN, CLOSED)`),
        // not to a group list.
        for (let i = 0; i < lines.length; i++) {
            const def = parseDefinitionLine(lines[i], i)
            const nameEnd = def ? lineOffsets[i] + def.range.end.character : -1
            GROUP_LIST_RE.lastIndex = 0
            let g
            while ((g = GROUP_LIST_RE.exec(maskedLines[i])) !== null) {
                if (lineOffsets[i] + g.index <= nameEnd) {
                    continue
                }
                let cursor = 0
                for (const part of g[1].split(',')) {
                    const name = part.trim()
                    if (NAME_TOKEN_RE.test(name)) {
                        candidates.push({
                            name,
                            index: lineOffsets[i] + g.index + 1 + cursor + part.indexOf(name),
                        })
                    }
                    cursor += part.length + 1 // +1 for the comma
                }
            }
        }
    }

    switch (extension) {
        case 'rules':
        case 'script':
            collectMatches(ITEM_TRIGGER_RE, maskedWhole, candidates)
            collectMatches(MEMBER_OF_RE, maskedWhole, candidates)
            collectMatches(ITEM_MEMBER_RE, maskedWhole, candidates)
            break
        case 'sitemap':
            collectMatches(SITEMAP_ITEM_RE, maskedWhole, candidates)
            collectMatches(VISIBILITY_RE, maskedWhole, candidates)
            break
        case 'persist': {
            // Only names inside an `Items { … }` block; a `Strategies { … }`
            // block defines strategy names, not items.
            const blocks = []
            PERSIST_ITEMS_BLOCK_RE.lastIndex = 0
            let b
            while ((b = PERSIST_ITEMS_BLOCK_RE.exec(maskedWhole)) !== null) {
                blocks.push([b.index + b[0].indexOf('{') + 1, b.index + b[0].length - 1])
            }
            collectMatches(PERSIST_NAME_RE, maskedWhole, candidates, (index) =>
                blocks.some(([s, e]) => index >= s && index < e),
            )
            break
        }
        default:
            break
    }

    // `val|var X = …` locals shadow item names for the rest of the rule, so
    // exclude the name entirely (name-keyed, not position-keyed).
    const locals = new Set()
    let dm
    while ((dm = LOCAL_DECL_RE.exec(maskedWhole)) !== null) {
        locals.add(dm[1])
    }

    const seen = new Set()
    const out = []
    for (const c of candidates) {
        const key = `${c.name}@${c.index}`
        if (seen.has(key) || locals.has(c.name) || isKnown(c.name)) {
            continue
        }
        seen.add(key)
        out.push(toRange(c.index, c.name))
    }
    return out
}

module.exports = { findUnknownItemRefs }
