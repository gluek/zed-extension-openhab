/**
 * Thing cache: fetches `GET /rest/things` from the openHAB instance so that
 * `channel="…"` in `.items` files can complete with real channel UIDs.
 *
 * The cache is refreshed from the `openhab/things/*` event stream (openHAB 4)
 * / `smarthome/things/*` (openHAB 3), same dual-prefix pattern as ItemStore;
 * any thing event triggers a debounced refetch of the full list (thing changes
 * are rare, and the list is small).
 */
'use strict'

const { baseUrlFor, authHeadersFor, SseParser } = require('./rest')

/** Debounce for refetching /rest/things after a thing event. */
const REFETCH_DEBOUNCE_MS = 1000

/** Event topics covering thing add/remove/update. */
const THING_TOPICS = 'smarthome/things/*,openhab/things/*'

class ThingStore {
    /**
     * @param {object} options
     * @param {(message: string) => void} [options.log]
     */
    constructor({ log = () => {} } = {}) {
        this.log = log
        /** @type {Map<string, Array<{uid: string, channelTypeUID?: string, label?: string, itemType?: string}>>} thingUID -> channels */
        this.channelsByThing = new Map()
        /** True once /rest/things loaded successfully at least once. While
         * false (instance unreachable), channel diagnostics must not run —
         * an empty cache would flag every channel. */
        this.loaded = false
        this.stopped = true
        this.abortController = undefined
        this.refetchTimer = undefined
    }

    /**
     * @param {{host: string, port: number, authToken?: string|null, basicAuth?: object|null}} config
     */
    async start(config) {
        this.config = config
        this.stopped = false
        await this.load()
        this.listen()
    }

    stop() {
        this.stopped = true
        this.loaded = false
        this.abortController?.abort()
        this.abortController = undefined
        if (this.refetchTimer) {
            clearTimeout(this.refetchTimer)
            this.refetchTimer = undefined
        }
    }

    get baseUrl() {
        return baseUrlFor(this.config)
    }

    get authHeaders() {
        return authHeadersFor(this.config)
    }

    /** Fetch all things and index their channels. Never throws. */
    async load() {
        try {
            const response = await fetch(`${this.baseUrl}/things`, { headers: this.authHeaders })
            if (!response.ok) {
                throw new Error(`status ${response.status}`)
            }
            const things = await response.json()
            if (!Array.isArray(things)) {
                throw new Error('no thing array')
            }
            this.channelsByThing.clear()
            for (const thing of things) {
                if (thing.UID && Array.isArray(thing.channels)) {
                    this.channelsByThing.set(thing.UID, thing.channels)
                }
            }
            this.loaded = true
            this.log(`loaded channels of ${this.channelsByThing.size} things`)
        } catch (error) {
            this.log(`cannot load things (${error.message}); channel completion limited`)
        }
    }

    /** True when `thingUID` exists on the instance (cache loaded). */
    hasThing(thingUID) {
        return this.channelsByThing.has(thingUID)
    }

    /** True when `uid` (`thingUID:channelId`) is a channel of a known thing. */
    hasChannel(uid) {
        const colon = uid.lastIndexOf(':')
        const thingUID = colon > 0 ? uid.slice(0, colon) : uid
        const channels = this.channelsByThing.get(thingUID)
        return !!channels && channels.some((c) => c.uid === uid)
    }

    /** Subscribe to thing events; refetch the list (debounced) on any event. */
    async listen() {
        this.abortController = new AbortController()
        try {
            const response = await fetch(`${this.baseUrl}/events?topics=${THING_TOPICS}`, {
                headers: { ...this.authHeaders, Accept: 'text/event-stream' },
                signal: this.abortController.signal,
            })
            if (!response.ok || !response.body) {
                throw new Error(`status ${response.status}`)
            }
            const sse = new SseParser()
            for await (const chunk of response.body) {
                if (this.stopped) {
                    return
                }
                // We only need to know that *some* thing event arrived.
                if (sse.feed(chunk).length > 0) {
                    this.scheduleRefetch()
                }
            }
        } catch (error) {
            if (this.stopped || error.name === 'AbortError') {
                return
            }
            this.log(`thing event stream ended (${error.message})`)
        }
        // Reconnect after the stream ends, like ItemStore.
        if (!this.stopped) {
            this.scheduleRefetch()
        }
    }

    scheduleRefetch() {
        if (this.stopped || this.refetchTimer) {
            return
        }
        this.refetchTimer = setTimeout(() => {
            this.refetchTimer = undefined
            if (!this.stopped) {
                this.load().then(() => this.listen())
            }
        }, REFETCH_DEBOUNCE_MS)
        this.refetchTimer.unref?.()
    }

    /**
     * All channel UIDs (`thingUID:channelId`) across all things, sorted.
     * @returns {Array<{uid: string, thingUID: string, label?: string, itemType?: string}>}
     */
    get allChannels() {
        const out = []
        for (const [thingUID, channels] of this.channelsByThing) {
            for (const ch of channels) {
                out.push({ uid: ch.uid, thingUID, label: ch.label, itemType: ch.itemType })
            }
        }
        return out.sort((a, b) => a.uid.localeCompare(b.uid))
    }

    /** Channel UIDs of one thing, e.g. for `channel="hue:0210:1:bulb1:…"`. */
    channelsOf(thingUID) {
        return this.channelsByThing.get(thingUID) || []
    }
}

module.exports = { ThingStore, THING_TOPICS }
