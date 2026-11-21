/**
 * Item-name occurrence finder, shared by inlay hints (B3) and semantic
 * tokens (B4).
 *
 * Unlike `references.js` (which searches for ONE name everywhere), this finds
 * EVERY item-name-shaped reference in a document in a single pass, using the
 * same per-file-type candidate rules as `diagnostics.js`:
 *
 *  - `.rules` / `.script`: rule triggers (`Item X changed`, `Member of (X)`)
 *    and member accesses (`X.state`, `X.sendCommand(…)`, …).
 *  - `.items`: the definition name token plus group-list names `(gAll, gLights)`
 *    (parens of the type chain `OR(OPEN, CLOSED)` excluded).
 *  - `.sitemap`: `item=X` and `visibility=[X==ON]`.
 *  - `.persist`: exact names in the `Items { … }` block (wildcards skipped).
 *
 * Strings/comments are masked (positions preserved) and `val|var` locals are
 * excluded, so a local named like an item is not reported.
 *
 * Everything is line-based — no tree-sitter in the Node bundle.
 */
'use strict'

const { maskStringsAndComments } = require('./references')
const { parseDefinitionLine } = require('./itemIndex')

/** Member accesses that only make sense on items. Group 2 = trailing `.member`. */
const ITEM_MEMBER_RE = /([A-Za-z_]\w*)(\.(?:state|sendCommand|postUpdate|members|lastState)\b)/g

/** `Item X changed` / `Item X received update …` trigger. Group 2 = trailing boundary. */
const ITEM_TRIGGER_RE = /(?:^|[^A-Za-z0-9_$])Item\s+([A-Za-z_]\w*)(?![A-Za-z0-9_$])/g

/** `Member of (X) …` trigger. Group 2 = trailing `)`. */
const MEMBER_OF_RE = /Member\s+of\s*\(\s*([A-Za-z_]\w*)(\s*\))/g

/** `item=X` in a sitemap widget. */
const SITEMAP_ITEM_RE = /\bitem\s*=\s*([A-Za-z_]\w*)/g

/** `visibility=[X==ON, Y!=OFF]` condition items. Group 2 = the operator. */
const VISIBILITY_RE = /(?:\[|,)\s*([A-Za-z_]\w*)\s*(==|!=)/g

/** Group list `(a, b)` on an .items line. */
const GROUP_LIST_RE = /\(([^()]*)\)/g

/** The `Items { … }` block of a .persist file (no nested braces inside). */
const PERSIST_ITEMS_BLOCK_RE = /\bItems\s*\{([^{}]*)\}/g

/** Persist entry name inside an Items block. Group 2 = optional `*`. */
const PERSIST_NAME_RE = /(?:^|[{,]\s*|\n\s*)([A-Za-z_]\w*)(\*?)/g

/** Local variable declaration in a rule body: `val X = …` / `var X = …`. */
const LOCAL_DECL_RE = /(?:^|[^A-Za-z0-9_$])(?:val|var)\s+([A-Za-z_]\w*)\s*=/g

const NAME_TOKEN_RE = /^[A-Za-z_]\w*$/

/**
 * Push `{name, index}` for every match of `re` in `masked`. `index` is the
 * absolute start offset of group 1; later (trailing) groups are subtracted
 * from the match length. Group 2 `*` (persist wildcard) skips the match.
 */
function collectMatches(re, masked, into) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(masked)) !== null) {
        if (m[2] === '*') {
            continue // persist wildcard
        }
        let trailing = 0
        for (let i = 2; i < m.length; i++) {
            trailing += (m[i] || '').length
        }
        into.push({ name: m[1], index: m.index + m[0].length - m[1].length - trailing })
    }
}

/**
 * All item-name occurrences in a document.
 *
 * @param {string} text full document text
 * @param {string} extension file extension without dot
 * @returns {Array<{name: string, range: object, isDefinition: boolean}>}
 *   `isDefinition` is true for the `.items` definition name token itself
 *   (false for group-list references on the same line).
 */
function findItemPositions(text, extension) {
    const lines = text.split(/\r?\n/)
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
        return { start: { line, character }, end: { line, character: character + name.length } }
    }

    /** @type {Array<{name: string, index: number, isDefinition: boolean}>} */
    const candidates = []

    if (extension === 'items') {
        for (let i = 0; i < lines.length; i++) {
            const def = parseDefinitionLine(lines[i], i)
            if (def) {
                candidates.push({ name: def.name, index: lineOffsets[i] + def.range.start.character, isDefinition: true })
            }
            // Group list: parens after the definition name (or on lines without
            // a definition). Parens before the name are the type chain.
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
                            isDefinition: false,
                        })
                    }
                    cursor += part.length + 1
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
            const blocks = []
            PERSIST_ITEMS_BLOCK_RE.lastIndex = 0
            let b
            while ((b = PERSIST_ITEMS_BLOCK_RE.exec(maskedWhole)) !== null) {
                blocks.push([b.index + b[0].indexOf('{') + 1, b.index + b[0].length - 1])
            }
            PERSIST_NAME_RE.lastIndex = 0
            let m
            while ((m = PERSIST_NAME_RE.exec(maskedWhole)) !== null) {
                if (m[2] === '*') {
                    continue
                }
                const start = m.index + m[0].length - m[1].length - (m[2] || '').length
                if (blocks.some(([s, e]) => start >= s && start < e)) {
                    candidates.push({ name: m[1], index: start, isDefinition: false })
                }
            }
            break
        }
        default:
            break
    }

    // `val|var X = …` locals shadow item names for the rest of the rule.
    const locals = new Set()
    let dm
    while ((dm = LOCAL_DECL_RE.exec(maskedWhole)) !== null) {
        locals.add(dm[1])
    }

    const seen = new Set()
    const out = []
    for (const c of candidates) {
        const key = `${c.name}@${c.index}`
        if (seen.has(key)) {
            continue
        }
        seen.add(key)
        if (locals.has(c.name)) {
            continue
        }
        out.push({
            name: c.name,
            range: toRange(c.index, c.name),
            isDefinition: !!c.isDefinition,
        })
    }
    return out
}

module.exports = { findItemPositions }
