/**
 * Icon completion data for `.items` files.
 *
 * The `item_icon` is the `<icon>` clause after the label
 * (`Switch X "label" <light>`; grammar: `item_icon: seq('<', field('name', $.identifier), '>')`).
 * openHAB accepts its classic OH2 icon set (the "oh" icons, e.g. `light`,
 * `temperature`, `door`) plus, since OH3, any Iconify icon name
 * (`mdi:lightbulb`, `fa-solid:fan`, …). We bundle the classic set and let
 * the `prefix:…` form pass through by completing the common prefixes.
 * Static — no REST call needed.
 */
'use strict'

const { maskCompleteStrings } = require('./semantictags')

/**
 * Classic openHAB (OH2) icon keywords usable inside `<…>`. This is the set
 * shipped by the classic UI / used by MainUI; OH3 additionally accepts any
 * Iconify name (`<mdi:lightbulb>`), which we surface via ICON_PREFIXES.
 */
const OH_ICONS = [
    'absorb',
    'airconditioner',
    'alarm',
    'arrow_down',
    'arrow_up',
    'asterisk',
    'attention',
    'babyphone',
    'bathtub',
    'battery',
    'bed',
    'bicycle',
    'blinds',
    'bluetooth',
    'boy',
    'briefcase',
    'calendar',
    'car',
    'cd',
    'chart',
    'clock',
    'computer',
    'contact',
    'delete',
    'door',
    'downstairs',
    'error',
    'fan',
    'female',
    'fire',
    'flower',
    'garage',
    'garbage',
    'girl',
    'group',
    'heating',
    'house',
    'humidity',
    'internet',
    'key',
    'light',
    'lightbulb',
    'lock',
    'machine',
    'male',
    'message',
    'motion',
    'network',
    'none',
    'oh',
    'office',
    'oven',
    'phone',
    'presence',
    'projector',
    'receiver',
    'refresh',
    'rollershutter',
    'screen',
    'settings',
    'siren',
    'slider',
    'smoke',
    'solar',
    'sound',
    'sport',
    'switch',
    'table',
    'temperature',
    'time',
    'tv',
    'upstairs',
    'video',
    'washer',
    'water',
    'window',
    'wind',
]

/** Iconify set prefixes accepted by openHAB 3+ inside `<…>` (e.g. `<mdi:lightbulb>`). */
const ICON_PREFIXES = ['mdi', 'fa-solid', 'fa-regular', 'fa-brands', 'wi', 'smarthome', 'oh']

/** LSP CompletionItemKind.Keyword */
const KIND_KEYWORD = 14

/** Item-definition line prefix (masked): `Type[:…] Name` plus the optional
 * label / icon / groups / tag-list-open clauses that may precede the cursor.
 * The trailing `$` anchor is optional via `rest` so the same shape can also
 * match a prefix that ends in an unclosed clause (`<`, `[`). */
const ITEM_PREFIX_OPEN_RE =
    /^\s*[A-Za-z_]\w*(?::[\w(),=]+)*\s+[A-Za-z_]\w*(\s+"")?(\s*<[^>\n]*)?(\s*\([^)]*\))?(\s*\[[^\]\n]*)?$/

/**
 * True when the cursor is inside the `<…>` icon clause of an `.items`
 * definition line: an unclosed `<` at clause position. The label is optional
 * (`Switch X <light>` is valid), so the `<` may directly follow the item name.
 */
function isIconPosition(extension, context) {
    if (extension !== 'items') {
        return false
    }
    const { before } = context
    if (before.includes('//')) {
        return false
    }
    // Inside an unclosed string (the label, or a config value) there is no
    // icon clause — an odd quote count means the cursor is in a string.
    const quotes = (before.match(/"/g) || []).length + (before.match(/'/g) || []).length
    if (quotes % 2 === 1) {
        return false
    }
    // An unclosed `<` at clause position: the masked line must match the
    // item prefix up to and including the open `<…` clause.
    const masked = maskCompleteStrings(before)
    return /<[^>\n]*$/.test(masked) && ITEM_PREFIX_OPEN_RE.test(masked)
}

/** Icon completions for the partial inside `<…>`. */
function iconCompletions(partial) {
    const items = OH_ICONS.filter((icon) => icon.startsWith(partial.toLowerCase())).map((icon) => ({
        label: icon,
        kind: KIND_KEYWORD,
        detail: 'openHAB icon',
    }))
    // Offer Iconify prefixes when the partial looks like `pr` or `md`.
    for (const prefix of ICON_PREFIXES) {
        if (prefix.startsWith(partial.toLowerCase()) && !prefix.includes(':')) {
            items.push({ label: `${prefix}:`, kind: KIND_KEYWORD, detail: 'iconify set' })
        }
    }
    return items
}

module.exports = { OH_ICONS, ICON_PREFIXES, isIconPosition, iconCompletions }
