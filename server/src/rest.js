/**
 * Shared plumbing for talking to the openHAB REST API and its event stream:
 * base-URL / auth-header derivation from the user settings (used by ItemStore,
 * ThingStore, ThingTypeStore) and an incremental SSE line parser (used by the
 * two `/rest/events` listeners).
 */
'use strict'

/**
 * Normalize the `host` setting into a base URL without a trailing slash.
 *
 * Accepts `"localhost"`, `"localhost:8080"` (port from the host wins over the
 * `port` setting), `"http://host:port"`, `"https://host"`, and IPv6 literals
 * (`"::1"` is bracketed to `[::1]` so the URL parses; `"[::1]:8080"` passes
 * through). Bare hosts get `http://` and the configured port (default 8080).
 */
function normalizeBaseUrl(host, port) {
    const raw = (host || 'localhost').trim().replace(/\/+$/, '')
    if (/^https?:\/\//i.test(raw)) {
        return raw
    }
    const portSuffix = `:${Number(port) || 8080}`
    if (raw.startsWith('[')) {
        // Bracketed IPv6 literal: pass through when it already carries a port
        // (`[::1]:8080`), otherwise append the configured one.
        return /^\[[^\]]+\]:\d+$/.test(raw) ? `http://${raw}` : `http://${raw}${portSuffix}`
    }
    if ((raw.match(/:/g) || []).length > 1) {
        // Bare IPv6 literal (multiple colons, no brackets): bracket it so the
        // colons are not mistaken for a host:port separator.
        return `http://[${raw}]${portSuffix}`
    }
    // A single colon means host:port — the port in `raw` wins.
    if (raw.includes(':')) {
        return `http://${raw}`
    }
    return `http://${raw}${portSuffix}`
}

/** Base REST URL for a settings object, e.g. `http://localhost:8080/rest`. */
function baseUrlFor(config) {
    return `${normalizeBaseUrl(config.host, config.port)}/rest`
}

/**
 * Authorization headers for a settings object, empty when no credentials are
 * configured. An API token (`authToken`) wins over basic auth.
 */
function authHeadersFor(config) {
    if (config.authToken) {
        return { Authorization: `Bearer ${config.authToken}` }
    }
    if (config.basicAuth && config.basicAuth.username) {
        const encoded = Buffer.from(`${config.basicAuth.username}:${config.basicAuth.password || ''}`).toString('base64')
        return { Authorization: `Basic ${encoded}` }
    }
    return {}
}

/**
 * Incremental SSE parser: feed stream chunks, get complete `data:` payloads.
 * A `data: …` line — or a single multi-byte UTF-8 character inside one — can
 * be split across chunks, so partial input is buffered until its newline
 * arrives (a naive per-chunk `decode().split('\n')` would mangle both cases
 * and silently drop the event).
 */
class SseParser {
    constructor() {
        this.decoder = new TextDecoder()
        this.buffer = ''
    }

    /**
     * Feed one chunk.
     *
     * @param {Uint8Array} chunk
     * @returns {string[]} complete `data:` payloads (prefix stripped, trimmed)
     */
    feed(chunk) {
        this.buffer += this.decoder.decode(chunk, { stream: true })
        return this._drain(false)
    }

    /** Flush the decoder at end of stream; returns a final unterminated `data:` line, if any. */
    end() {
        this.buffer += this.decoder.decode()
        return this._drain(true)
    }

    _drain(flush) {
        const payloads = []
        let nl
        while ((nl = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.slice(0, nl)
            this.buffer = this.buffer.slice(nl + 1)
            if (line.startsWith('data:')) {
                payloads.push(line.slice('data:'.length).trim())
            }
        }
        if (flush && this.buffer.startsWith('data:')) {
            payloads.push(this.buffer.slice('data:'.length).trim())
            this.buffer = ''
        }
        return payloads
    }
}

/**
 * Trailing debounce: `fn` runs `ms` milliseconds after the *last* call, so a
 * burst of calls collapses into one run. Returns the debounced function; call
 * `.cancel()` to drop a pending run.
 */
function debounce(fn, ms) {
    let timer
    function debounced(...args) {
        if (timer) {
            clearTimeout(timer)
        }
        timer = setTimeout(() => {
            timer = undefined
            fn(...args)
        }, ms)
        // Do not hold the process open just for a pending callback.
        timer.unref?.()
    }
    debounced.cancel = () => {
        if (timer) {
            clearTimeout(timer)
            timer = undefined
        }
    }
    return debounced
}

module.exports = { normalizeBaseUrl, baseUrlFor, authHeadersFor, SseParser, debounce }
