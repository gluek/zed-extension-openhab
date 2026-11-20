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

1. Clone this repository (`git clone https://github.com/gluek/openhab-zed.git`).
2. In Zed: `zed: install dev extension` and select the cloned directory.

The grammar is fetched from the public
[`gluek/tree-sitter-openhab`](https://github.com/gluek/tree-sitter-openhab)
repository at the `rev` pinned in `extension.toml`, so no local mirror step is
needed. During grammar development, `grammar/` in this repo is the source of
truth — push changes to the grammar repo and repoint the `rev`.

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

See [`tests/README.md`](tests/README.md) for the query-validation harness.

```sh
./tests/validate-queries.sh                                     # queries compile (5/5)
./tests/check-snapshots.sh                                      # parse-tree snapshots (20 ok)
(cd server && node --test test/completion.test.js test/itemStore.test.js test/hover.test.js)  # language server tests (29 pass)
cargo build --release --target wasm32-wasip2                    # extension wasm (needs the wasm32-wasip2 target)
```

(When hacking in a restricted sandbox, crate deps may need a local cargo home:
`CARGO_HOME=$PWD/.scratch/cargo ... --offline`.)

Layout:

```
extension.toml            # manifest: grammar + language server registration
Cargo.toml / src/         # Rust extension: language_server_command + settings
grammar/                  # tree-sitter-openhab grammar (fork of tree-sitter-java)
languages/openhab/        # config.toml + tree-sitter queries (.scm)
server/                   # bundled Node LSP server (see server/README.md)
tests/                    # parse harness, fixtures, snapshots, validation scripts
```
