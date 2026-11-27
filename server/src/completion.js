/**
 * Decides whether item names belong at the cursor, and builds the completion
 * items.
 *
 * The VS Code extension returns every item in every position (see the TODO in
 * its Server.js). That makes item completion useless inside `.things` files and
 * inside string literals, where an item name is almost never what is wanted.
 * This module narrows completion to positions where openHAB accepts one.
 */
'use strict'

/** LSP CompletionItemKind.Variable */
const KIND_VARIABLE = 6

/**
 * The 12 base item types offered in `.items` type position. This is a subset
 * of the grammar's `dsl_type_word` (grammar/grammar.js), which also lists
 * `Call`, `StringList`, `QuantityType` and the sitemap widget words — see
 * `itemIndex.ITEM_TYPES` for that full matching list.
 */
const ITEM_TYPES = [
    'Color',
    'Contact',
    'DateTime',
    'Dimmer',
    'Group',
    'Image',
    'Location',
    'Number',
    'Player',
    'Rollershutter',
    'String',
    'Switch',
]

/**
 * Cursor context: the cursor's line and the text either side of the cursor.
 *
 * @param {string} source full document text
 * @param {{line: number, character: number}} position LSP position
 */
function contextAt(source, position) {
    const line = source.split(/\r?\n/)[position.line] || ''
    return {
        line,
        before: line.slice(0, position.character),
        after: line.slice(position.character),
    }
}

/**
 * True when the cursor is inside a string literal or after a line comment, as
 * far as the current line reveals. Multi-line block comments are not detected;
 * a completion offered inside one is simply ignored by the user.
 */
function inStringOrComment({ before }) {
    if (before.includes('//')) {
        return true
    }
    const quotes = (before.match(/"/g) || []).length + (before.match(/'/g) || []).length
    return quotes % 2 === 1
}

/**
 * Suggest item *types* at the start of a `.items` definition line.
 *
 * Every `.items` line begins with a type, and nothing later on the line can be
 * one, so restricting to the leading token is both cheap and accurate. The
 * `Group:Number:AVG` chain is excluded because those segments are unit or
 * aggregation types, not item types.
 */
function isItemTypePosition(extension, context) {
    if (extension !== 'items') {
        return false
    }
    return /^\s*[A-Za-z_]*$/.test(context.before)
}

/**
 * Decide whether to offer item names at this position.
 *
 * @param {string} extension one of items, rules, script, sitemap, things, persist
 */
function offersItems(extension, context) {
    if (inStringOrComment(context)) {
        return false
    }
    switch (extension) {
        case 'items':
        case 'rules':
        case 'script':
            return true
        case 'sitemap':
            // `item=…`, `visibility=[…]`, and comma-separated lists.
            return /(\bitem\s*=\s*|\[|,)\s*[\w_]*$/.test(context.before)
        case 'things':
        case 'persist':
            // `.things` never takes item names. `.persist` does, but only inside
            // its `Items { }` block; per-line detection there is not worth the
            // false positives, so item completion is skipped for both.
            return false
        default:
            return false
    }
}

/**
 * True when the cursor is in the UID position of a `Thing …` / `Bridge …`
 * header in a `.things` file, i.e. after the keyword and before any label
 * string or config bracket.
 *
 * @param {string} extension
 * @param {{before: string}} context from `contextAt`
 */
function isThingUidPosition(extension, context) {
    if (extension !== 'things' || inStringOrComment(context)) {
        return false
    }
    return /^\s*(?:Thing|Bridge)\s+[A-Za-z0-9_:\-]*$/.test(context.before)
}

/** LSP CompletionItemKind.Module */
const KIND_MODULE = 9

/** LSP CompletionItemKind.Field */
const KIND_FIELD = 5

/**
 * True when the cursor is inside the quoted value of `channel="…"` in an
 * `.items` file (the only place channel UIDs are written).
 *
 * @param {string} extension
 * @param {{before: string}} context from `contextAt`
 */
function isChannelValuePosition(extension, context) {
    if (extension !== 'items') {
        return false
    }
    // `channel="` prefix with the string still open (no closing quote yet).
    return /\bchannel\s*=\s*"[^"]*$/.test(context.before)
}

/**
 * Completions for the channel UID value. The partial may be a full thing UID
 * prefix (`hue:0210:1:bulb1:`) or just a channel id suffix; in both cases we
 * offer matching channel UIDs of known things.
 *
 * @param {string} partial typed text inside the quotes
 * @param {Array<{uid: string, thingUID: string, label?: string, itemType?: string}>} allChannels
 */
function channelCompletions(partial, allChannels) {
    return allChannels
        .filter((ch) => ch.uid.startsWith(partial) || ch.uid.includes(':' + partial))
        .map((ch) => ({
            label: ch.uid,
            kind: KIND_FIELD,
            detail: ch.label || ch.thingUID,
            ...(ch.itemType ? { documentation: `item type: ${ch.itemType}` } : {}),
        }))
}

/**
 * Completions for the thing-UID position: binding IDs when no `:` has been
 * typed yet, otherwise the thing-type UIDs of that binding.
 *
 * @param {string} partial the UID prefix typed so far (`''`, `h`, `hue:`, `hue:02`)
 * @param {string[]} bindingIds all binding IDs from the thing-type store
 * @param {(binding: string, opts?: object) => string[]} uidsForBinding
 */
function thingUidCompletions(partial, bindingIds, uidsForBinding) {
    const items = []
    if (!partial.includes(':')) {
        // No binding prefix yet: offer binding IDs; also offer full UIDs of
        // bindings whose ID starts with the partial (so `hu` completes to
        // `hue` and `hue:…` types).
        for (const binding of bindingIds) {
            if (binding.startsWith(partial)) {
                items.push({ label: binding, kind: KIND_MODULE, detail: 'binding' })
            }
        }
    } else {
        const binding = partial.split(':')[0]
        for (const uid of uidsForBinding(binding)) {
            if (uid.startsWith(partial) || uid === binding) {
                items.push({ label: uid, kind: KIND_MODULE, detail: 'thing type' })
            }
        }
    }
    return items
}

/**
 * Build completion items for the given items.
 *
 * @param {object[]} items Item instances from the store
 */
function itemCompletions(items) {
    return items.map((item) => ({
        label: item.name,
        kind: KIND_VARIABLE,
        // The type is what tells a user whether `X.sendCommand(ON)` is valid.
        detail: item.type,
        documentation: documentationFor(item),
    }))
}

/** Markdown shown in the completion details pane. */
function documentationFor(item) {
    const lines = [item.label || item.name]
    if (item.state) {
        lines.push(`State: \`${item.state}\``)
    }
    if (item.dimension) {
        lines.push(`Dimension: ${item.dimension}`)
    }
    if (item.tags.length) {
        lines.push(`Tags: ${item.tags.join(', ')}`)
    }
    if (item.groupNames.length) {
        lines.push(`Groups: ${item.groupNames.join(', ')}`)
    }
    return lines.join('\n\n')
}

/** Item-type completions for `.items` type position. */
function typeCompletions() {
    return ITEM_TYPES.map((type) => ({
        label: type,
        // LSP CompletionItemKind.Class
        kind: 7,
        detail: 'item type',
    }))
}

module.exports = {
    ITEM_TYPES,
    contextAt,
    channelCompletions,
    documentationFor,
    inStringOrComment,
    isChannelValuePosition,
    isItemTypePosition,
    isThingUidPosition,
    itemCompletions,
    offersItems,
    thingUidCompletions,
    typeCompletions,
}
