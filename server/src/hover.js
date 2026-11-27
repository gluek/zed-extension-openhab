/**
 * Hover support: resolve the item name under the cursor and render its live
 * state as Markdown.
 *
 * The word at the cursor is extracted with the same identifier characters Zed
 * uses for the openHAB language (`word_characters = ["_", "$"]` in
 * languages/openhab/config.toml plus alphanumerics), then looked up in the
 * ItemStore. Unknown words (rule-local variables, DSL keywords, labels inside
 * strings) simply produce no hover — hovering is opt-in by position, and a
 * missing hover is never an error.
 */
'use strict'

const { lineAt } = require('./files')

/** Characters that make up an openHAB item name at the cursor. */
const WORD_CHAR = /[A-Za-z0-9_$]/

/**
 * The word under the cursor and its LSP range, or null when the cursor is not
 * on a word.
 *
 * @param {string | object} source full document text, or the TextDocument
 *   (preferred: avoids splitting the whole document per request)
 * @param {{line: number, character: number}} position LSP position
 * @returns {{word: string, range: {start: {line: number, character: number}, end: {line: number, character: number}}} | null}
 */
function wordRangeAt(source, position) {
    const line = lineAt(source, position)
    const col = Math.min(position.character, line.length)
    if (!WORD_CHAR.test(line[col] || '') && !(col > 0 && WORD_CHAR.test(line[col - 1]))) {
        return null
    }
    let start = col
    while (start > 0 && WORD_CHAR.test(line[start - 1])) {
        start -= 1
    }
    let end = col
    while (end < line.length && WORD_CHAR.test(line[end])) {
        end += 1
    }
    const word = line.slice(start, end)
    if (!word) {
        return null
    }
    return {
        word,
        range: {
            start: { line: position.line, character: start },
            end: { line: position.line, character: end },
        },
    }
}

/**
 * The item name under the cursor, or null when the cursor is not on a word.
 *
 * @param {string | object} source full document text, or the TextDocument
 * @param {{line: number, character: number}} position LSP position
 */
function wordAt(source, position) {
    const at = wordRangeAt(source, position)
    return at ? at.word : null
}

/**
 * Build the LSP Hover for an item.
 *
 * Only the live state is shown — that is what hovering an item name is for;
 * the type and metadata are visible in the completion details instead. The
 * value is prefixed with `State: ` so the tooltip reads as a label, not a
 * bare code span.
 *
 * @param {import('./Item')} item
 * @returns {{contents: {kind: string, value: string}}}
 */
function hoverFor(item) {
    const value = item.state ? `State: \`${item.state}\`` : 'State: _(none yet)_'
    return {
        contents: { kind: 'markdown', value },
    }
}

module.exports = { wordAt, wordRangeAt, hoverFor, WORD_CHAR }
