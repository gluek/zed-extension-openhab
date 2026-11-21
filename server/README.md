# openHAB Language Server (Zed)

Item-name completion for openHAB textual configuration files, ported from the
[openHAB VS Code extension](https://github.com/openhab/openhab-vscode)'s
`serverJS` directory.

The extension downloads a **pre-built bundle** (`server/openhab-language-server.js`,
committed to this repository at a pinned commit, see `SERVER_COMMIT` in
`../src/openhab.rs`) through the Zed extension API on first use and stores it in
the extension's work directory. It is not embedded in the extension wasm. Zed's
bundled Node.js runs it; there is no `npm install` at runtime and no
`node_modules` in the shipped extension.

## Configuration

Settings are read from `lsp.openhab-lsp.settings` in Zed's `settings.json`:

```json
{
  "lsp": {
    "openhab-lsp": {
      "settings": {
        "host": "localhost",
        "port": 8080,
        "authToken": null,
        "lspEnabled": true
      }
    }
  }
}
```

| Key         | Default     | Meaning                                              |
| ----------- | ----------- | ---------------------------------------------------- |
| `host`      | `localhost` | bare host, `host:port`, or full URL incl. scheme (`https://…`) |
| `port`      | `8080`      | REST API port (only applies when `host` has no port) |
| `authToken` | `null`      | openHAB 4 API token, sent as `Authorization: Bearer` |
| `basicAuth` | `null`      | `{ "username": …, "password": … }` for basic auth    |
| `lspEnabled`| `true`      | set `false` to disable completion entirely           |

Settings are read from `initializationOptions` at startup and then from
`workspace/configuration`, so changing them and restarting the server takes
effect without restarting Zed.

## What differs from the VS Code server

These are deliberate; see the comments in `src/` for the reasoning.

- **Transport.** stdio is passed explicitly:
  `createConnection(ProposedFeatures.all, process.stdin, process.stdout)`.
  Zed passes `--stdio` on the command line; argv sniffing (upstream's
  `--node-ipc` detection) threw "Connection input stream is not set" under Zed.
- **No `eventsource` dependency.** The event stream is consumed with Node's
  built-in `fetch`, which follows openHAB's redirect and needs no bundle. The
  subscription filter is `smarthome/items/*,openhab/items/*`: openHAB 3
  publishes item events under `smarthome/items`, openHAB 4 under `openhab/items`
  (see `ItemEventFactory` in openhab-core), and the SSE endpoint anchors the
  filter at the end, so the trailing `*` makes it a prefix match.
- **Auth is implemented.** The VS Code server talks plain `http://` only;
  this one sends an API token or basic auth when configured.
- **Context-aware completion.** Upstream returns every item in every position
  (its own `TODO`). This server only offers item names where openHAB accepts
  them, and never inside strings or comments.
- **Hover shows live state.** Hovering an item name returns just its current
  state as Markdown, prefixed with `State: ` (`` State: `ON` ``, or
  `State: _(none yet)_` when never set) — resolved against the same cache
  completion uses, so it is live via the event stream.
- **Failures are visible.** Connection problems are reported as LSP log
  messages (shown in Zed's log), and the stream reconnects with a 10 s backoff.
- **No diagnostics.** Upstream's `DocumentValidator` is a stub returning an
  empty array, so it is not ported rather than advertising a provider that never
  reports anything.
- **No `itemCasing` setting.** Upstream only uses it for the "Create Items from
  Channels" command, which has no Zed equivalent.
- **Thing-type completion in `.things`.** The server fetches
  `GET /rest/thing-types` at startup (and on connection-setting changes) and
  offers binding IDs after `Thing `/`Bridge ` with no `:` yet, or the binding's
  thing-type UIDs after `hue:` etc. (`src/thingTypes.js`).
- **Navigation (go-to-definition / references / rename).** The server scans the
  worktree's `.items` files into a definition index (`src/itemIndex.js`,
  refreshed on `workspace/didChangeWatchedFiles`) and finds references
  textually across `.items/.rules/.script/.sitemap/.persist`
  (`src/references.js`), excluding strings, comments, the definition itself,
  `val`/`var` locals, and persist wildcards. Zed maps LSP `definition`,
  `references`, and `rename` onto its native commands, so `editor: go to
  definition` etc. work out of the box. Rename is workspace-text only — the
  running openHAB instance is not renamed.

## Development

```sh
cd server
npm --cache ../.scratch/npm-cache install   # once; installs esbuild + the two runtime deps
npm --cache ../.scratch/npm-cache run build  # rebuild openhab-language-server.js after editing src/
node --test test/completion.test.js test/itemStore.test.js   # unit tests (24 pass)
```

On this machine use Zed's managed Node
(`~/.local/share/zed/node/node-v24.22.1-linux-x64/bin/node`) — `/usr/bin/node`
is broken (missing `libsimdjson.so.36`) — and pass test files explicitly to
`node --test` (a bare `test/` dir fails on this Node version; `integration.test.js`
hangs, pre-existing). `npm test` also includes an end-to-end test that spawns
the bundled server over stdio against a fake openHAB REST API and asserts that
item completions come back for a `.rules` file.

**Always rebuild the bundle before committing** — the committed `.js` is what
users actually run, so a stale bundle silently ignores source changes.
