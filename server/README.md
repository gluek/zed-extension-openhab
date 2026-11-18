# openHAB Language Server (Zed)

Item-name completion for openHAB textual configuration files, ported from the
[openHAB VS Code extension](https://github.com/openhab/openhab-vscode)'s
`serverJS` directory.

The extension ships a **pre-built bundle** (`server/openhab-language-server.js`,
committed to the repository). Zed's bundled Node.js runs it; there is no
`npm install` at runtime and no `node_modules` in the shipped extension.

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
| `host`      | `localhost` | openHAB host or IP                                   |
| `port`      | `8080`      | REST API port                                        |
| `authToken` | `null`      | openHAB 4 API token, sent as `Authorization: Bearer` |
| `basicAuth` | `null`      | `{ "username": …, "password": … }` for basic auth    |
| `lspEnabled`| `true`      | set `false` to disable completion entirely           |

Settings are read from `initializationOptions` at startup and then from
`workspace/configuration`, so changing them and restarting the server takes
effect without restarting Zed.

## What differs from the VS Code server

These are deliberate; see the comments in `src/` for the reasoning.

- **Transport.** Transport is not sniffed from argv. Zed passes `--stdio`; the
  server uses stdio unless `--node-ipc` is given.
- **No `eventsource` dependency.** The event stream is consumed with Node's
  built-in `fetch`, which follows openHAB's redirect and needs no bundle.
- **Auth is implemented.** The VS Code server talks plain `http://` only;
  this one sends an API token or basic auth when configured.
- **Context-aware completion.** Upstream returns every item in every position
  (its own `TODO`). This server only offers item names where openHAB accepts
  them, and never inside strings or comments.
- **Failures are visible.** Connection problems are reported as LSP log
  messages (shown in Zed's log), and the stream reconnects with a 10 s backoff.
- **No diagnostics.** Upstream's `DocumentValidator` is a stub returning an
  empty array, so it is not ported rather than advertising a provider that never
  reports anything.
- **No `itemCasing` setting.** Upstream only uses it for the "Create Items from
  Channels" command, which has no Zed equivalent.

## Development

```sh
cd server
npm install          # once; installs esbuild + the two runtime deps
npm run build        # rebuild openhab-language-server.js after editing src/
npm test             # node:test unit + end-to-end tests
```

`npm test` includes an end-to-end test that spawns the bundled server over
stdio against a fake openHAB REST API and asserts that item completions come
back for a `.rules` file.

**Always rebuild the bundle before committing** — the committed `.js` is what
users actually run, so a stale bundle silently ignores source changes.
