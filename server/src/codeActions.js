/**
 * Code actions, all backed by the openHAB REST API or a workspace edit:
 *
 *  - `openhab.sendCommand` — on an item name in `.rules`/`.script`/`.sitemap`
 *    (or the definition in `.items`): POST /rest/items/{name} with the given
 *    command. Offered for every known item under the cursor; the command is
 *    asked for via the code-action arguments (Zed shows an input when the
 *    action is picked if it is a `Command` without arguments — in practice we
 *    offer the common commands ON/OFF/INCREASE/DECREASE/UP/DOWN/STOP/… for
 *    the item type, so no prompt is needed).
 *  - `openhab.runRule` — on a `rule "…"` line in `.rules`: POST
 *    /rest/rules/{id}/run. The rule UID is the `ruleUID` metadata or, for
 *    files-based rules, the `rule "name"` id; openHAB 4 runs rules by UID.
 *  - `openhab.createItemFromChannel` — on a `channel="thing:…:channel"` line
 *    in `.items`: a new item definition for that channel (the upstream
 *    "Create Items from Channels" command, ported to a code action). The
 *    action carries the WorkspaceEdit directly on the CodeAction — Zed's
 *    apply_code_action ignores executeCommand *results*, it only applies
 *    edits on the action or sent via workspace/applyEdit.
 *
 * Only the positions where the action makes sense are offered, so the action
 * list stays short. Zed executes `Command`-style actions through
 * `workspace/executeCommand` (the command must be listed in
 * `executeCommandProvider.commands`), and applies `edit`-only actions directly.
 */
'use strict'

const { pathToFileURL } = require('node:url')
const path = require('node:path')

const { wordRangeAt } = require('./hover')
const { lineAt } = require('./files')
const { NAME_RE, parseDefinitionLine } = require('./itemIndex')

/** Commands offered per item type for `sendCommand` (openHAB core item commands). */
const COMMANDS_BY_TYPE = {
    Switch: ['ON', 'OFF'],
    Dimmer: ['ON', 'OFF', 'INCREASE', 'DECREASE'],
    Rollershutter: ['UP', 'DOWN', 'STOP'],
    Player: ['PLAY', 'PAUSE', 'STOP', 'NEXT', 'PREVIOUS'],
    Color: ['ON', 'OFF'],
    Number: [],
    String: [],
    DateTime: [],
    Contact: [],
    Location: [],
    Group: null, // group type depends on members; offer the common switch set
}

/** Commands offered when the item type is unknown or a group. */
const DEFAULT_COMMANDS = ['ON', 'OFF']

/** `channel="…"` assignment anywhere on a `.items` line. */
const CHANNEL_ASSIGN_RE = /\bchannel\s*=\s*"([^"]+)"/g

/** `rule "…"` header in a `.rules` file; group 1 = the rule name/UID. */
const RULE_HEADER_RE = /^\s*rule\s+"([^"]+)"/

/** Derive an item name from a channel UID: `hue:0210:1:bulb1:color` -> `Hue_0210_1_Bulb1_Color`. */
function itemNameFromChannelUid(uid) {
    const cleaned = uid
        .split(':')
        .map((part) => part.replace(/[^A-Za-z0-9_]/g, '_'))
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('_')
    return /^[A-Za-z_]/.test(cleaned) ? cleaned : `Item_${cleaned}`
}

/**
 * Build the code actions applicable at `params.range` in a document.
 *
 * @param {string | object} source full document text, or the TextDocument
 * @param {string} extension file extension without dot
 * @param {{range: object, textDocument: {uri: string}, context?: {diagnostics?: object[]}}} params LSP CodeActionParams
 * @param {object} ctx
 * @param {(name: string) => object|undefined} ctx.itemFor returns the live Item (or undefined)
 * @param {(name: string) => boolean} ctx.isKnownItem item in worktree index ∪ live cache
 * @param {(thingUID: string) => Array<{uid: string, itemType?: string, label?: string}>} ctx.channelsOf
 * @returns {Array<object>} LSP CodeAction objects (with `edit` or `command`)
 */
function codeActionsAt(source, extension, params, ctx) {
    const text = typeof source === 'string' ? source : source.getText()
    const actions = []
    const lineNo = params.range.start.line
    const line = lineAt(source, params.range.start)
    const col = params.range.start.character

    /** sendCommand actions for `word` (per-type when the live item is known). */
    const pushSendCommand = (word) => {
        if (!word || !NAME_RE.test(word) || !ctx.isKnownItem(word)) {
            return
        }
        const item = ctx.itemFor(word)
        const type = item ? (item.type || '').replace(/:.*$/, '') : '' // strip unit: Number:Temperature
        const commands = COMMANDS_BY_TYPE[type] || DEFAULT_COMMANDS
        for (const cmd of commands) {
            actions.push({
                title: `Send ${cmd} to ${word}`,
                kind: 'quickfix',
                command: {
                    title: `Send ${cmd} to ${word}`,
                    command: 'openhab.sendCommand',
                    arguments: [word, cmd],
                },
            })
        }
    }

    if (extension === 'rules' || extension === 'script') {
        // `rule "…"` header -> run the rule on the instance.
        const rule = RULE_HEADER_RE.exec(line)
        if (rule && col <= rule[0].length) {
            actions.push({
                title: `Run rule "${rule[1]}" on openHAB`,
                kind: 'quickfix',
                command: {
                    title: `Run rule "${rule[1]}"`,
                    command: 'openhab.runRule',
                    arguments: [rule[1]],
                },
            })
        }
        pushSendCommand(wordRangeAt(source, params.range.start)?.word)
        return actions
    }

    if (extension === 'items') {
        // Item definition name under the cursor -> sendCommand (the definition
        // line is where you stand when you want to toggle the item).
        const def = parseDefinitionLine(line, lineNo)
        if (def) {
            const word = wordRangeAt(source, params.range.start)?.word
            if (word === def.name) {
                pushSendCommand(word)
            }
        }
        // `channel="…"` on this line -> create an item from the channel. The
        // edit rides on the CodeAction itself (Zed ignores executeCommand
        // results when applying a picked action).
        CHANNEL_ASSIGN_RE.lastIndex = 0
        let m
        while ((m = CHANNEL_ASSIGN_RE.exec(line)) !== null) {
            const uid = m[1]
            const colon = uid.lastIndexOf(':')
            const thingUID = colon > 0 ? uid.slice(0, colon) : uid
            const channels = ctx.channelsOf(thingUID)
            const channel = channels.find((c) => c.uid === uid)
            if (!channel) {
                continue
            }
            const itemType = channel.itemType || 'Switch'
            const name = itemNameFromChannelUid(uid)
            actions.push({
                title: `Create item ${name} (${itemType}) from channel ${uid}`,
                kind: 'quickfix',
                edit: createItemEdit(params.textDocument.uri, text, { name, itemType, channelUID: uid }),
            })
        }
        return actions
    }

    if (extension === 'sitemap') {
        pushSendCommand(wordRangeAt(source, params.range.start)?.word)
    }

    return actions
}

/**
 * The WorkspaceEdit for `openhab.createItemFromChannel`: append a new item
 * definition at the end of the `.items` file the channel was referenced in
 * (the document the action was invoked on).
 *
 * @param {string} uri file URI of the .items document
 * @param {string} text its current text
 * @param {{name: string, itemType: string, channelUID: string}} args
 */
function createItemEdit(uri, text, { name, itemType, channelUID }) {
    const endsWithNewline = text.endsWith('\n')
    const line = `${itemType} ${name} "${name}" { channel="${channelUID}" }\n`
    const insertAt = text.length
    const position = positionOf(text, insertAt)
    return {
        changes: {
            [uri]: [
                {
                    range: { start: position, end: position },
                    newText: (endsWithNewline || text === '' ? '' : '\n') + line,
                },
            ],
        },
    }
}

/** Convert a character offset into an LSP position. */
function positionOf(text, offset) {
    const lines = text.slice(0, offset).split('\n')
    return { line: lines.length - 1, character: lines[lines.length - 1].length }
}

/** The item types the REST `POST /rest/items` accepts as `type` (no unit suffix needed). */
module.exports = { codeActionsAt, createItemEdit, itemNameFromChannelUid, COMMANDS_BY_TYPE }
