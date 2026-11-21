/**
 * Thing-type cache: fetches `GET /rest/thing-types` from the openHAB instance
 * and offers binding IDs and full thing-type UIDs for completion in `.things`
 * files.
 *
 * `Thing <uid> "label" …` takes a thing-type UID (`hue:0210:…`, or the short
 * `0210` form inside a Bridge, which inherits the bridge's binding). Completion
 * therefore offers, in a `.things` file:
 *   - after `Thing `/`Bridge ` with no `:` yet: binding IDs (`hue`, `mqtt`, …)
 *     plus short type IDs of the enclosing bridge's binding, when known;
 *   - after a binding prefix `hue:`: the thing types of that binding.
 */
'use strict'

/**
 * @typedef {{UID: string, label?: string, description?: string, category?: string, bridge?: boolean, listed?: boolean}} ThingTypeDTO
 */

class ThingTypeStore {
    /**
     * @param {object} options
     * @param {(message: string) => void} [options.log]
     * @param {(config: object) => {baseUrl: string, authHeaders: object}} [options.rest] builds REST base URL + headers from settings (injectable for tests)
     */
    constructor({ log = () => {}, rest } = {}) {
        this.log = log
        this.rest = rest || defaultRest
        /** @type {ThingTypeDTO[]} */
        this.types = []
        this.loaded = false
    }

    /** Fetch and cache all thing types. Never throws. */
    async load(config) {
        const { baseUrl, authHeaders } = this.rest(config)
        try {
            const response = await fetch(`${baseUrl}/thing-types`, { headers: authHeaders })
            if (!response.ok) {
                throw new Error(`status ${response.status}`)
            }
            const types = await response.json()
            if (!Array.isArray(types)) {
                throw new Error('no thing-type array')
            }
            this.types = types
            this.loaded = true
            this.log(`loaded ${types.length} thing types`)
        } catch (error) {
            this.log(`cannot load thing types (${error.message}); thing completion disabled`)
            this.types = []
            this.loaded = false
        }
    }

    /** All distinct binding IDs (`hue`, `mqtt`, …), sorted. */
    get bindingIds() {
        const ids = new Set()
        for (const t of this.types) {
            const binding = (t.UID || '').split(':')[0]
            if (binding) {
                ids.add(binding)
            }
        }
        return [...ids].sort()
    }

    /**
     * Thing-type UIDs for a binding, e.g. `['hue:0210', 'hue:0017', …]`.
     * `shortIds` also returns the type ID without the binding prefix
     * (`0210`), valid inside a `Bridge <binding>:… { … }` body.
     */
    uidsForBinding(binding, { shortIds = false } = {}) {
        const out = []
        for (const t of this.types) {
            const parts = (t.UID || '').split(':')
            if (parts[0] !== binding) {
                continue
            }
            out.push(t.UID)
            if (shortIds && parts.length >= 2) {
                out.push(parts.slice(1).join(':'))
            }
        }
        return out.sort()
    }

    /**
     * Completion context in a `.things` file: what has been typed on the line
     * before the cursor, e.g. `    Thing hue:` → `{ before: '    Thing hue:' }`.
     *
     * @param {{before: string}} context from `completion.contextAt`
     */
    thingTypeContext(context) {
        // `Thing ` or `Bridge ` at the start (after whitespace) begins a UID.
        const m = /^\s*(?:Thing|Bridge)\s+([A-Za-z0-9_:\-]*)$/.exec(context.before)
        if (!m) {
            return null
        }
        return { partial: m[1] }
    }
}

const { normalizeBaseUrl } = require('./ItemStore')

/** Default REST adapter: normalize host/port and build auth headers. */
function defaultRest(config) {
    const baseUrl = `${normalizeBaseUrl(config.host, config.port)}/rest`
    const authHeaders = {}
    if (config.authToken) {
        authHeaders.Authorization = `Bearer ${config.authToken}`
    } else if (config.basicAuth && config.basicAuth.username) {
        authHeaders.Authorization =
            'Basic ' + Buffer.from(`${config.basicAuth.username}:${config.basicAuth.password || ''}`).toString('base64')
    }
    return { baseUrl, authHeaders }
}

module.exports = { ThingTypeStore }
