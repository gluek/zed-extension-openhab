/**
 * Item cache: seeds from the openHAB REST API and keeps itself current via the
 * server-sent event stream.
 *
 * Adapted from the openHAB VS Code extension's ItemCompletionProvider, with
 * these deliberate differences:
 *
 *  - Uses Node's built-in `fetch` instead of the `eventsource` package. Node's
 *    fetch follows the 302 that openHAB redirects `/rest/events?topics=…` to,
 *    and needs no bundle. This keeps the shipped server dependency-free.
 *  - Supports openHAB 4 API tokens (`Authorization: Bearer`) and basic auth,
 *    which the VS Code version never implemented.
 *  - Reports connection failures through a callback instead of logging to a
 *    VS Code output channel that Zed cannot see.
 *  - Reconnects with a bounded delay, since a restarting openHAB is the common
 *    case and a dead server would otherwise never recover.
 *
 * @see https://github.com/openhab/openhab-vscode/blob/main/serverJS/src/ItemCompletion/ItemCompletionProvider.js
 */
'use strict'

const Item = require('./Item')

/** Delay before retrying a failed event stream, in milliseconds. */
const RECONNECT_DELAY_MS = 10_000

/**
 * openHAB event topic filter for the `/rest/events` stream.
 *
 * openHAB 3 used the `smarthome/items` prefix; since openHAB 4 the event bus
 * publishes under `openhab/items` (see ItemEventFactory in openhab-core), and
 * the SSE endpoint matches the `topics` filter against the full topic with an
 * implicit `$` anchor, so the trailing `*` is what makes this a prefix match.
 * Both spellings are subscribed to so the server works against openHAB 3 and 4.
 */
const EVENT_TOPICS = 'smarthome/items/*,openhab/items/*'

/**
 * Normalize the `host` setting into a base URL without a trailing slash.
 *
 * Accepts `"localhost"`, `"localhost:8080"` (port from the host wins over the
 * `port` setting), `"http://host:port"`, and `"https://host"`. Bare hosts get
 * `http://` and the configured port (default 8080).
 */
function normalizeBaseUrl(host, port) {
    const raw = (host || 'localhost').trim().replace(/\/+$/, '')
    if (/^https?:\/\//i.test(raw)) {
        return raw
    }
    if (raw.includes(':')) {
        return `http://${raw}`
    }
    return `http://${raw}:${Number(port) || 8080}`
}

class ItemStore {
    /**
     * @param {object} options
     * @param {(message: string) => void} [options.log] receives status messages
     */
    constructor({ log = () => {} } = {}) {
        this.log = log
        this.items = new Map()
        this.config = undefined
        this.abortController = undefined
        this.reconnectTimer = undefined
        this.stopped = true
    }

    /**
     * (Re)connect to an openHAB instance.
     *
     * Never throws: a wrong host or a stopped instance is a normal state, not a
     * crash, and the user may fix it later without restarting the editor.
     *
     * @param {{host: string, port: number, authToken?: string|null, basicAuth?: {username: string, password: string}|null}} config
     */
    async restart(config) {
        this.configure(config)
        this.stop({ keepConfig: true })
        this.stopped = false
        await this.connect()
    }

    /** Update the config without reconnecting (used for non-connection keys). */
    configure(config) {
        this.config = {
            // `host` may be given as a bare host, a host:port pair, or a full
            // URL with a scheme. Normalize to a base URL so both
            // `"host": "openhab.local"` and `"host": "https://openhab.local"`
            // work; an explicit `port` only applies to bare hosts.
            baseUrl: normalizeBaseUrl(config.host, config.port),
            authToken: config.authToken || null,
            basicAuth: config.basicAuth || null,
        }
    }

    /** Base REST URL, e.g. `http://localhost:8080/rest`. */
    get baseUrl() {
        return `${this.config.baseUrl}/rest`
    }

    /** Authorization headers, empty when no credentials are configured. */
    get authHeaders() {
        const { authToken, basicAuth } = this.config
        if (authToken) {
            return { Authorization: `Bearer ${authToken}` }
        }
        if (basicAuth && basicAuth.username) {
            const encoded = Buffer.from(`${basicAuth.username}:${basicAuth.password || ''}`).toString('base64')
            return { Authorization: `Basic ${encoded}` }
        }
        return {}
    }

    async connect() {
        try {
            await this.loadItems()
        } catch (error) {
            this.log(`cannot reach openHAB at ${this.config.baseUrl} (${error.message}); item completion disabled`)
            this.scheduleReconnect()
            return
        }
        if (this.stopped) {
            return
        }
        this.log(`loaded ${this.items.size} items from ${this.config.baseUrl}`)
        this.listen()
    }

    /**
     * Seed the cache from `GET /rest/items`.
     *
     * The trailing slash matters: without it openHAB answers with a redirect
     * that some clients (including Node's fetch in older versions) mishandle.
     */
    async loadItems() {
        const response = await fetch(`${this.baseUrl}/items/`, { headers: this.authHeaders })
        if (!response.ok) {
            throw new Error(`REST API request failed with status ${response.status}`)
        }
        const items = await response.json()
        if (!Array.isArray(items)) {
            throw new Error('REST API returned no item array')
        }
        this.items.clear()
        for (const raw of items) {
            this.items.set(raw.name, new Item(raw))
        }
    }

    /**
     * Subscribe to the item event stream.
     *
     * The stream is consumed manually rather than via EventSource because
     * Node has no EventSource and the wire format is a trivial `data: ` line
     * per event.
     */
    async listen() {
        this.abortController = new AbortController()
        try {
            const response = await fetch(`${this.baseUrl}/events?topics=${EVENT_TOPICS}`, {
                headers: { ...this.authHeaders, Accept: 'text/event-stream' },
                signal: this.abortController.signal,
            })
            if (!response.ok || !response.body) {
                throw new Error(`event stream failed with status ${response.status}`)
            }
            const decoder = new TextDecoder()
            for await (const chunk of response.body) {
                if (this.stopped) {
                    return
                }
                for (const line of decoder.decode(chunk).split('\n')) {
                    if (line.startsWith('data:')) {
                        this.handleEvent(line.slice('data:'.length).trim())
                    }
                }
            }
        } catch (error) {
            if (this.stopped || error.name === 'AbortError') {
                return
            }
            this.log(`event stream ended (${error.message}); reconnecting`)
        }
        this.scheduleReconnect()
    }

    scheduleReconnect() {
        if (this.stopped || this.reconnectTimer) {
            return
        }
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined
            if (!this.stopped) {
                this.connect()
            }
        }, RECONNECT_DELAY_MS)
        // Do not hold the process open just to retry.
        this.reconnectTimer.unref?.()
    }

    /**
     * Apply a single event from the item event stream.
     *
     * @param {string} payload the JSON `data:` line of an SSE event
     */
    handleEvent(payload) {
        let event
        try {
            event = JSON.parse(payload)
            event.payload = JSON.parse(event.payload)
        } catch {
            return
        }
        // Topics look like `openhab/items/<name>/state` (openHAB 4+) or
        // `smarthome/items/<name>/state` (openHAB 3); the item name is the
        // third path segment in both.
        const name = (event.topic || '').split('/')[2]
        if (!name) {
            return
        }
        switch (event.type) {
            case 'ItemStateEvent':
            case 'ItemStateChangedEvent': {
                // openHAB 4 wraps this as {type, value}; older versions pass the
                // raw state ("{type: 'OnOff', value: 'ON'}" vs "ON").
                const existing = this.items.get(name)
                if (!existing) {
                    return
                }
                const next = event.payload.value !== undefined ? event.payload.value : event.payload
                existing.state = typeof next === 'object' ? next.value : next
                if (typeof next === 'object' && next.type) {
                    existing.type = next.type
                }
                break
            }
            case 'ItemUpdatedEvent':
                // [new, old]; only the new copy matters.
                this.items.set(name, new Item(event.payload[0]))
                break
            case 'ItemAddedEvent':
                this.items.set(name, new Item(event.payload))
                break
            case 'ItemRemovedEvent':
                this.items.delete(name)
                break
            default:
                break
        }
    }

    /**
     * Stop streaming. The item cache is dropped unless `keepConfig` is set,
     * since `restart` immediately refills it.
     */
    stop({ keepConfig = false } = {}) {
        this.stopped = true
        this.abortController?.abort()
        this.abortController = undefined
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = undefined
        }
        this.items.clear()
        if (!keepConfig) {
            this.config = undefined
        }
    }

    /** Items as a plain array, sorted by name for stable completion ordering. */
    get all() {
        return [...this.items.values()].sort((a, b) => a.name.localeCompare(b.name))
    }

    get size() {
        return this.items.size
    }
}

module.exports = ItemStore
