/**
 * openHAB item definition, adapted from the openHAB VS Code extension.
 *
 * @see https://github.com/openhab/openhab-vscode/blob/main/serverJS/src/ItemCompletion/Item.js
 */
'use strict'

// openHAB reports these instead of a real value when an item has never been
// updated. Showing them in completion documentation is pure noise.
const NULL_STATES = new Set(['NULL', 'UNDEF'])

class Item {
    /**
     * @param {object} item raw item as returned by `GET /rest/items`
     */
    constructor(item) {
        this.item = item
    }

    /** Unique item name, e.g. `Kitchen_Temperature`. */
    get name() {
        return this.item.name
    }

    /** Item type, e.g. `Switch`, `Number`, `Group`. */
    get type() {
        return this.item.type
    }

    set type(type) {
        this.item.type = type
    }

    set state(state) {
        this.item.state = state
    }

    /** Label, which may embed a state format such as `Temperature [%.1f °C]`. */
    get label() {
        return this.item.label
    }

    /** Category, used for icons. */
    get category() {
        return this.item.category
    }

    /** Current state, with `NULL`/`UNDEF` reported as empty. */
    get state() {
        return NULL_STATES.has(this.item.state) ? '' : this.item.state
    }

    /**
     * Dimension for unit-carrying number items (`Number:Temperature`), as
     * reported by openHAB 4 in `type: "Number"` + `dimension: "Temperature"`.
     */
    get dimension() {
        return this.item.dimension
    }

    /** True for the special `Group` item type. */
    get isGroup() {
        return this.item.type === 'Group'
    }

    /** Tags, used by some add-ons. */
    get tags() {
        return this.item.tags || []
    }

    /** Names of the groups this item belongs to. */
    get groupNames() {
        return this.item.groupNames || []
    }
}

module.exports = Item
