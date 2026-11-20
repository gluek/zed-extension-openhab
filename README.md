# openHAB for Zed

A [Zed](https://zed.dev) language extension for [openHAB](https://www.openhab.org)
textual configuration files, ported from the
[openHAB VS Code extension](https://github.com/openhab/openhab-vscode).

It provides:

- **Syntax highlighting**, bracket matching, auto-indent, code outline, and text
  objects for all openHAB file types, using a purpose-built tree-sitter grammar
  (`grammar/`, a fork of tree-sitter-java with openHAB DSL productions).
- **Item-name completion** from your running openHAB instance, via a bundled
  language server (`server/`) that fetches `/rest/items` and follows the
  `/rest/events` stream for live updates.
- **Hover on an item name** shows its live state (same cache as completion —
  no extra requests).

## Supported files

| Suffix       | Content                                   |
| ------------ | ----------------------------------------- |
| `.items`     | Item definitions                          |
| `.things`    | Thing / Bridge / Channel definitions      |
| `.sitemap`   | Sitemap definitions                       |
| `.rules`     | Rules (Java-like DSL)                     |
| `.script`    | Scripts                                   |
| `.persist`   | Persistence strategies and item filters   |

Comments are `//` line comments and `/* … */` block comments. Indentation is
4 spaces.

## Installation

### From the Zed extension marketplace (once published)

Search for **openHAB** in Zed's extension list (`zed: extensions`).

### As a dev extension (from this repository)

1. Clone this repository.
2. In Zed: `zed: install dev extension` and select this directory.

   The grammar is referenced from a local git mirror of `grammar/`
   (`.scratch/grammar-repo`). If it is missing or stale, rebuild it and update
   the `rev` in `extension.toml`:

   ```sh
   ./tests/make-grammar-mirror.sh                 # prints the new rev to pin
   ```

   (When the extension is published, `extension.toml` points at the public
   `openhab/tree-sitter-openhab` repository instead and this step is unnecessary.)

## Configuration

Item completion talks to your openHAB REST API. Configure it in Zed's
`settings.json` under `lsp.openhab-lsp.settings`:

```json
{
  "lsp": {
    "openhab-lsp": {
      "settings": {
        "host": "localhost",
        "port": 8080,
        "authToken": null,
        "basicAuth": null,
        "lspEnabled": true
      }
    }
  }
}
```

| Key          | Default     | Meaning                                                |
| ------------ | ----------- | ------------------------------------------------------ |
| `host`       | `localhost` | openHAB host, `host:port`, or full URL incl. scheme (`https://…`) |
| `port`       | `8080`      | REST API port (only used for bare hosts)               |
| `authToken`  | `null`      | openHAB 4 API token, sent as `Authorization: Bearer`  |
| `basicAuth`  | `null`      | `{ "username": "…", "password": "…" }` for basic auth |
| `lspEnabled` | `true`      | set `false` to disable the language server entirely    |

Completion is offered where openHAB accepts item names (`.items`, `.rules`,
`.script`, `.sitemap`) and is suppressed inside strings and comments. Hovering
an item name shows its current state. If openHAB is unreachable, the server
logs a message in Zed's log (`zed: open log`) and retries every 10 seconds;
it never crashes.

## Development

See [`plan.md`](plan.md) for status, architecture, and caveats, and
[`tests/README.md`](tests/README.md) for the query-validation harness.

```sh
./tests/validate-queries.sh                                     # queries compile (5/5)
./tests/check-snapshots.sh                                      # parse-tree snapshots (20 ok)
(cd server && node --test test/completion.test.js test/itemStore.test.js test/hover.test.js)  # language server tests (29 pass)
CARGO_HOME=$PWD/.scratch/cargo cargo build --target wasm32-wasip2 --offline   # extension wasm
```

(Use a working Node — on this machine that is Zed's managed Node at
`~/.local/share/zed/node/node-v24.22.1-linux-x64/bin/node`; `/usr/bin/node` is
broken. Pass test files explicitly, not `node --test test/`.)

Layout:

```
extension.toml            # manifest: grammar + language server registration
Cargo.toml / src/         # Rust extension: language_server_command + settings
grammar/                  # tree-sitter-openhab grammar (fork of tree-sitter-java)
languages/openhab/        # config.toml + tree-sitter queries (.scm)
server/                   # bundled Node LSP server (see server/README.md)
tests/                    # parse harness, fixtures, snapshots, validation scripts
```
