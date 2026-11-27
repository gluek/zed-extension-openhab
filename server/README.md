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
- **Unknown-item diagnostics.** Upstream's `DocumentValidator` is a stub
  returning an empty array, so it is not ported; instead the server implements
  its own check (`src/diagnostics.js`): item-name references that exist neither
  in the worktree `.items` index nor in the live item cache are published as
  warnings on `didOpen`/`didChange` (cleared on close). Candidate positions are
  per file type — rule triggers and member accesses in `.rules`/`.script`,
  group lists in `.items`, `item=`/`visibility=` in `.sitemap`, exact names in
  the `Items { … }` block of `.persist` — with strings/comments masked and
  `val`/`var` locals excluded. `.items` files additionally get unknown-tag
  warnings (`findUnknownTags`): a quoted value in a `["…"]` tag list that is
  not in the semantic ontology (`SEMANTIC_TAGS`), not used by another item
  definition in the worktree (position-aware: the line being checked does not
  count), and not on the running instance is flagged.
- **No `itemCasing` setting.** Upstream only uses it for the "Create Items from
  Channels" command, which has no Zed equivalent.
- **Thing-type completion in `.things`.** The server fetches
  `GET /rest/thing-types` at startup (and on connection-setting changes) and
  offers binding IDs after `Thing `/`Bridge ` with no `:` yet, or the binding's
  thing-type UIDs after `hue:` etc. (`src/thingTypes.js`).
- **Channel completion in `.items`.** `GET /rest/things` is fetched at startup
  and kept current via the `openhab/things/*` (openHAB 4) / `smarthome/things/*`
  (openHAB 3) event stream with a debounced refetch (`src/things.js`). Inside
  `channel="…"` the completion offers real channel UIDs of your things.
- **Unknown-channel diagnostics in `.items`.** `findUnknownChannels`
  (`src/diagnostics.js`) validates every `channel="…"` value (comma-separated
  lists included) against the thing cache: the thing part must exist and the
  full UID must be one of its channels, otherwise an error is published on
  `didOpen`/`didChange`. The check only runs once the thing cache has loaded
  successfully, so an unreachable instance does not flag every channel; open
  documents are re-validated after (re)connect.
- **Inlay hints with live state.** `textDocument/inlayHint` returns the
  current state after every item-name occurrence in openHAB files
  (`src/itemPositions.js` finds the occurrences; only items present in the live
  cache get a hint). When the event stream changes an item, the server asks the
  client to refresh (`workspace/inlayHint/refresh`, guarded by
  `workspace.inlayHint.refreshSupport` read from the **initialize params** —
  vscode-languageserver 7.0 never populates `connection.client.capabilities`,
  so reading it there silently no-ops), so hints follow state changes without
  an edit.
- **Semantic tokens.** `textDocument/semanticTokens/full` marks item
  references as `variable` and `.items` definition names as `property` +
  `declaration`, so Zed colors them differently from locals/keywords. Built
  with `SemanticTokensBuilder` (correct delta encoding).
- **Code actions + executeCommand.** `textDocument/codeAction` offers
  `quickfix` actions at sensible positions (`src/codeActions.js`), and
  `workspace/executeCommand` runs them: `openhab.sendCommand` (POST
  `/rest/items/{name}` with a per-type command list) on item names in
  `.rules`/`.script`/`.sitemap` and on `.items` definition names;
  `openhab.runRule` on `rule "…"` headers (resolves the display name to the
  rule UID via `GET /rest/rules` first, then POSTs `/rest/rules/{uid}/runnow`
  — openHAB's actual endpoint; it calls `runNow(uid, considerConditions=false)`,
  so the `when` triggers are NOT evaluated, only the `then` block runs);
  `openhab.createItemFromChannel` on `channel="…"` lines in `.items` — its
  CodeAction carries the WorkspaceEdit directly, because Zed's
  `apply_code_action` applies action edits but ignores executeCommand
  *results*. The commands are advertised in `executeCommandProvider.commands`,
  which Zed requires before executing.
- **Icon + semantic-tag completion in `.items`.**
  `src/icons.js` bundles the classic OH icon set (plus Iconify prefixes
  `mdi:`/`fa-solid:`/…) for the `<icon>` clause and the semantic-ontology tag
  list (`Equipment`, `Point`, `Measurement`, `Temperature`, `Lightbulb`, …)
  for the `["…"]` tag list. Position detection requires the label string (and
  optionally the icon) before the bracket, so the label and Location config
  don't trigger tag completion. Project-local tags are collected from the
  worktree's `.items` files (rescanned on `didChangeWatchedFiles`) and offered
  first. Tags outside the ontology / project / instance are warned about —
  see unknown-tag diagnostics above.
- **Navigation (go-to-definition / references / rename).** The server scans the
  worktree's `.items` files into a definition index (`src/itemIndex.js`,
  refreshed on `workspace/didChangeWatchedFiles`) and finds references
  textually across `.items/.rules/.script/.sitemap/.persist`
  (`src/references.js`), excluding strings, comments, the definition itself,
  `val`/`var` locals, and persist wildcards. Zed maps LSP `definition`,
  `references`, and `rename` onto its native commands, so `editor: go to
  definition` etc. work out of the box. Rename is workspace-text only — the
  running openHAB instance is not renamed.
- **Unknown-item diagnostics** as described above; no capability flag is
  needed (the client pushes diagnostics by default when documents sync).

## Development

```sh
cd server
npm --cache ../.scratch/npm-cache install   # once; installs esbuild + the two runtime deps
npm --cache ../.scratch/npm-cache run build  # rebuild openhab-language-server.js after editing src/
npm test                                    # unit tests (e2e excluded)
npm run test:e2e                            # stdio end-to-end test against a fake REST API
```

On this machine use Zed's managed Node
(`~/.local/share/zed/node/node-v24.22.1-linux-x64/bin/node`) — `/usr/bin/node`
is broken (missing `libsimdjson.so.36`), and a bare `node --test test/` fails on
this Node version, so `npm test` lists the unit test files explicitly and keeps
the stdio end-to-end test (`test/integration.test.js`) behind `npm run test:e2e`.

**Always rebuild the bundle before committing** — the committed `.js` is what
users actually run, so a stale bundle silently ignores source changes.
