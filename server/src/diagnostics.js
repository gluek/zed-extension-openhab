/**
 * Unknown-item / unknown-tag / unknown-channel diagnostics.
 *
 * Item-reference candidates come from the shared scanner in
 * `itemOccurrences.js` (the single implementation, also used by inlay hints,
 * semantic tokens, and the used-tag scan); this module only filters them by
 * "known" and attaches messages. Channel diagnostics stay here because they
 * match `channel="…"` values, not item names.
 *
 * Candidate positions per file type (see itemOccurrences.js):
 *  - `.rules` / `.script`: rule triggers (`Item X changed`,
 *    `Member of (X) …`) and member accesses (`X.state`, `X.sendCommand(…)`, …).
 *  - `.items`: group-list names `(gAll, gLights)` (the definition name token
 *    itself is excluded — it IS the definition).
 *  - `.sitemap`: `item=X` bindings and `visibility=[X==ON, Y!=OFF]` conditions.
 *  - `.persist`: exact names inside the `Items { … }` block only (wildcards
 *    `gTemperature*` / `*` are skipped, `Strategies { … }` blocks ignored).
 *
 * Strings and comments are masked and `val|var` locals excluded (all in the
 * shared scanner).
 */
'use strict'

const { maskStringsAndComments } = require('./references')
const { SEMANTIC_TAGS } = require('./semantictags')
const { findItemOccurrences, tagListValues } = require('./itemOccurrences')

/**
 * `channel="…"` (or single-quoted) in an `.items` metadata block. Group 1 is
 * the double-quoted value, group 2 the single-quoted one.
 */
const CHANNEL_ASSIGN_RE = /\bchannel\s*=\s*"([^"]*)"|\bchannel\s*=\s*'([^']*)'/g

/** LSP range of `text` starting at (line, character). */
function rangeOn(line, character, text) {
    return {
        range: {
            start: { line, character },
            end: { line, character: character + text.length },
        },
        name: text,
    }
}

/**
 * All unknown-item reference diagnostics in a document: occurrences from the
 * shared scanner that are not the definition itself and not known
 * (worktree `.items` index ∪ live cache).
 *
 * @param {string} text full document text
 * @param {string} extension file extension without dot
 * @param {(name: string) => boolean} isKnown item exists (index ∪ live cache)
 * @returns {Array<{range: object, name: string, message: string}>}
 */
function findUnknownItemRefs(text, extension, isKnown) {
    return findItemOccurrences(text, extension)
        .filter((c) => !c.isDefinition && !isKnown(c.name))
        .map((c) => ({
            range: c.range,
            name: c.name,
            message: `Unknown item '${c.name}' (not defined in any .items file and not present on the openHAB instance)`,
        }))
}

/**
 * Unknown semantic tags in a `.items` document: every quoted value in a
 * `["…"]` tag list that is neither in openHAB's ontology (`SEMANTIC_TAGS`),
 * nor used by any other item in the worktree, nor present on the running
 * instance (live item tags). The check runs per definition line.
 *
 * @param {string} text full document text
 * @param {(tag: string, pos: {line: number, character: number}) => boolean} isKnownTag
 *   extra known tags (project ∪ live). Receives the match position so the
 *   caller can exclude tags used only on the very line being checked.
 * @returns {Array<{range: object, name: string, message: string}>}
 */
function findUnknownTags(text, isKnownTag) {
    const known = (tag, pos) => SEMANTIC_TAGS.includes(tag) || isKnownTag(tag, pos)
    const out = []
    const lines = text.split(/\r?\n/)
    let inBlock = false
    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
        const raw = lines[lineNo]
        // Mask strings/comments per line (block-comment state carried across
        // lines), but read the tag values from the RAW line so offsets stay
        // true to the document; skip lists whose `[` falls inside a masked
        // region.
        const [masked, next] = maskStringsAndComments(raw, inBlock)
        inBlock = next
        for (const { tag, character, bracket } of tagListValues(raw)) {
            if (masked[bracket] === ' ') {
                continue // tag list inside a string or comment
            }
            if (known(tag, { line: lineNo, character })) {
                continue
            }
            out.push({
                range: {
                    start: { line: lineNo, character },
                    end: { line: lineNo, character: character + tag.length },
                },
                name: tag,
                message: `Unknown semantic tag '${tag}' (not in openHAB's ontology, not used by any item in this project, and not present on the openHAB instance)`,
            })
        }
    }
    return out
}

/**
 * Unknown-channel diagnostics in a `.items` document: every `channel="…"`
 * value (a value may list several UIDs, comma-separated) is checked against
 * the live things. The thing part of the UID (everything before the last `:`)
 * must exist, and the full UID must be one of that thing's channels. The
 * caller only invokes this when the thing cache actually loaded — otherwise
 * an unreachable openHAB would flag every channel.
 *
 * Strings/comments are masked per line; matches whose `channel` keyword sits
 * inside a masked region are skipped (the value itself is read from the raw
 * line so offsets stay true to the document).
 *
 * @param {string} text full document text
 * @param {{isKnownThing: (thingUID: string) => boolean, isKnownChannel: (uid: string) => boolean}} known
 * @returns {Array<{range: object, name: string, message: string, severity: number}>}
 */
function findUnknownChannels(text, known) {
    const out = []
    const lines = text.split(/\r?\n/)
    let inBlock = false
    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
        const raw = lines[lineNo]
        const [masked, next] = maskStringsAndComments(raw, inBlock)
        inBlock = next
        CHANNEL_ASSIGN_RE.lastIndex = 0
        let m
        while ((m = CHANNEL_ASSIGN_RE.exec(raw)) !== null) {
            if (masked[m.index] === ' ') {
                continue // `channel=` inside a string or comment
            }
            const value = m[1] ?? m[2] ?? ''
            const valueStart = m.index + m[0].search(/["']/) + 1
            let cursor = 0
            for (const part of value.split(',')) {
                const uid = part.trim()
                if (uid) {
                    const offset = valueStart + cursor + part.indexOf(uid)
                    const colon = uid.lastIndexOf(':')
                    const thingUID = colon > 0 ? uid.slice(0, colon) : uid
                    if (!known.isKnownThing(thingUID)) {
                        out.push({
                            ...rangeOn(lineNo, offset, uid),
                            severity: 1, // Error: the link can never resolve
                            message: `Unknown thing '${thingUID}' in channel '${uid}' (thing not present on the openHAB instance)`,
                        })
                    } else if (!known.isKnownChannel(uid)) {
                        out.push({
                            ...rangeOn(lineNo, offset, uid),
                            severity: 1,
                            message: `Channel '${uid}' does not exist on thing '${thingUID}'`,
                        })
                    }
                }
                cursor += part.length + 1 // +1 for the comma
            }
        }
    }
    return out
}

module.exports = { findUnknownChannels, findUnknownItemRefs, findUnknownTags }
