/**
 * Icon and semantic-tag completion data for `.items` files (B10 + B11).
 *
 * Both lists are static — no REST call needed:
 *
 *  - `item_icon` is the `<icon>` clause after the label
 *    (`Switch X "label" <light>`; grammar: `item_icon: seq('<', field('name', $.identifier), '>')`).
 *    openHAB accepts its classic OH2 icon set (the "oh" icons, e.g. `light`,
 *    `temperature`, `door`) plus, since OH3, any Iconify icon name
 *    (`mdi:lightbulb`, `fa-solid:fan`, …). We bundle the classic set and let
 *    the `prefix:…` form pass through by completing the common prefixes.
 *  - `tag_list` is the `["Tag", …]` clause after the icon
 *    (grammar: `tag_list: seq('[', commaSep($._oh_string), ']')`). Values are
 *    semantic tags from openHAB's ontology
 *    (https://www.openhab.org/docs/tutorial/model.html): the top-level classes
 *    `Equipment`, `Point`, `Property`, `Location` (plus `Room` as a Location
 *    sub-class), the `Point` sub-types `Measurement`/`Setpoint`/`Control`,
 *    common `Property` sub-types, and the `Equipment` sub-classes.
 */
'use strict'

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

/**
 * Semantic tags from openHAB's ontology
 * (https://www.openhab.org/docs/tutorial/model.html#introduction-to-the-ontology-and-relationships).
 * Grouped for readable completion details; all are valid in `["…"]`.
 */
const SEMANTIC_TAGS = [
    // Top-level classes
    'Equipment',
    'Point',
    'Property',
    'Location',
    'Room',
    // Point sub-types
    'Measurement',
    'Setpoint',
    'Control',
    // Common Property sub-types
    'Temperature',
    'Humidity',
    'Light',
    'Presence',
    'Smoke',
    'Noise',
    'Vibration',
    'Pressure',
    'Wind',
    'Rain',
    'UV',
    'OpenLevel',
    'Alarm',
    'LowBattery',
    'Connectivity',
    'Energy',
    'Power',
    'Current',
    'Voltage',
    'Frequency',
    'Gas',
    'Water',
    'Color',
    'Duration',
    'Speed',
    // Common Equipment sub-classes
    'Lightbulb',
    'Switch',
    'Sensor',
    'Door',
    'Window',
    'Lock',
    'Blinds',
    'Shutter',
    'Thermostat',
    'HVAC',
    'Camera',
    'Speaker',
    'Battery',
    'Charger',
    'Vehicle',
    'Cleaner',
    'Doorbell',
    'Fan',
    'Inverter',
    'Media',
    'MotionSensor',
    'NetworkDevice',
    'PowerOutlet',
    'Printer',
    'Projector',
    'Receiver',
    'Router',
    'Screen',
    'SmartMeter',
    'Siren',
    'WeatherStation',
    'WhiteGood',
]

/** LSP CompletionItemKind.Keyword */
const KIND_KEYWORD = 14

/** LSP CompletionItemKind.EnumMember (semantic tags behave like enum members) */
const KIND_ENUM_MEMBER = 20

/**
 * True when the cursor is inside the `<…>` icon clause of an `.items`
 * definition line: a `<` after the label string, unclosed up to the cursor.
 */
function isIconPosition(extension, context) {
    if (extension !== 'items') {
        return false
    }
    // The icon clause always follows the label `"…"`; require a closed label
    // string before the `<` so a `<` in the label or in a config value does
    // not match.
    return /"[^"]*"\s*<[^>]*$/.test(context.before)
}

/**
 * True when the cursor is inside a quoted string of the `["…", "…"]` tag
 * list on an `.items` definition line.
 */
function isTagPosition(extension, context) {
    if (extension !== 'items') {
        return false
    }
    // The tag list follows the label `"…"` (and optionally the icon `<…>`);
    // require a closed label string before the `[`. Inside the brackets only
    // tag content up to an unclosed quote — a `=` (Location config
    // `[ latitude="…" ]`) excludes the bracket.
    return /"[^"]*"(?:\s*<[^>]*>)?\s*\[[^\]=]*"[^"]*$/.test(context.before)
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

/** Semantic-tag completions for the partial inside `["…"]`. */
function tagCompletions(partial, extraTags = []) {
    const seen = new Set()
    const items = []
    for (const tag of [...extraTags, ...SEMANTIC_TAGS]) {
        if (seen.has(tag) || !tag.toLowerCase().startsWith(partial.toLowerCase())) {
            continue
        }
        seen.add(tag)
        items.push({ label: tag, kind: KIND_ENUM_MEMBER, detail: 'semantic tag' })
    }
    return items
}

module.exports = { OH_ICONS, ICON_PREFIXES, SEMANTIC_TAGS, isIconPosition, isTagPosition, iconCompletions, tagCompletions }
