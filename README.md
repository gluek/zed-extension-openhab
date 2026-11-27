# openHAB for Zed

A [Zed](https://zed.dev) language extension for [openHAB](https://www.openhab.org)
textual configuration files, ported from the
[openHAB VS Code extension](https://github.com/openhab/openhab-vscode).

It provides:

- **Syntax highlighting**, bracket matching, auto-indent, code outline, and text
  objects for all openHAB file types, using a purpose-built tree-sitter grammar
  (`grammar/`, a fork of tree-sitter-java with openHAB DSL productions).
- **Item-name completion** from your running openHAB instance, via a
  language server (`server/`) that is downloaded at first use from this
  repository (pinned commit in `src/openhab.rs`) and run with Zed's bundled
  Node.js. It fetches `/rest/items` and follows the `/rest/events` stream for
  live updates.
- **Hover on an item name** shows its live state (same cache as completion —
  no extra requests).
- **Go-to-definition, references, and rename** for item names across all
  openHAB files in the project (`.items` definitions ↔ usages in `.rules`,
  `.script`, `.sitemap`, `.persist`). Works through Zed's native
  `editor: go to definition` / `editor: find all references` / rename commands.
- **Thing-type completion** in `.things` files: binding IDs and thing-type
  UIDs from your openHAB instance's `/rest/thing-types`.
- **Channel completion** in `.items` files: inside `channel="…"`, offer the
  channel UIDs of your things (from `/rest/things`, kept live via events).
- **Unknown-item warnings**: references to an item name that is neither
  defined in any `.items` file in the project nor present on the running
  openHAB instance are underlined as warnings in `.rules`, `.script`,
  `.sitemap`, `.persist`, and group lists in `.items` — catches typos in rules
  that would otherwise silently never fire.
- **Live-state inlay hints**: each item name in `.rules`, `.script`, `.items`,
  `.sitemap`, and `.persist` shows its current state right after the name
  (e.g. `Kitchen_Light  ON`), updated live via the event stream.
- **Semantic highlighting**: item names are colored as variables and item
  definitions as declarations, distinguishing them from rule-local variables
  and DSL keywords.
- **Code actions** (via `editor: code actions`): *Send ON/OFF/… to item* on an
  item name in `.rules`/`.script`/`.sitemap` (POSTs to the running instance),
  *Run rule* on a `rule "…"` header (POST `/rest/rules/{uid}/runnow`), and
  *Create item from channel* on a `channel="…"` line in `.items` (inserts a
  linked item definition).
- **Icon and tag completion** in `.items`: inside `<…>` after the label, offer
  openHAB's classic icon keywords plus Iconify set prefixes (`mdi:`, …);
  inside `["…"]` of the tag list, offer the [semantic ontology
  tags](https://www.openhab.org/docs/tutorial/model.html) (`Point`,
  `Measurement`, `Lighting`-style project tags from your other `.items`
  files, …).
- **Unknown-tag warnings**: in the `["…"]` tag list of an `.items`
  definition, a tag that is neither in openHAB's semantic ontology, nor used
  by another item in the project, nor present on the running instance is
  underlined as a warning — catches misspelled semantic tags.
- **Unknown-channel errors**: a `channel="…"` in an `.items` definition that
  points at a thing not on the running instance, or at a channel that thing
  does not have (e.g. a typo like `mqtt:broker:nuc:statuz`), is underlined as
  an error — the link can never resolve. Checked against `/rest/things`, so
  it only runs while the instance is reachable.

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

1. Clone this repository (`git clone https://github.com/gluek/zed-extension-openhab.git`).
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
it never crashes. Unknown item references (not in any `.items` file in the
project and not on the instance) are reported as warnings while you edit,
as are unknown semantic tags in `.items` tag lists. `channel="…"` links in
`.items` are validated against the instance's things (`/rest/things`): an
unknown thing or a channel the thing does not have is reported as an error
(only while the instance is reachable).

## Development

See [`tests/README.md`](tests/README.md) for the query-validation harness.

```sh
./tests/validate-queries.sh                                     # queries compile (5/5)
./tests/check-snapshots.sh                                      # parse-tree snapshots (20 ok)
(cd server && npm test)                                                 # language server unit tests
cargo build --release --target wasm32-wasip2                    # extension wasm (needs the wasm32-wasip2 target)
```

(When hacking in a restricted sandbox, crate deps may need a local cargo home:
`CARGO_HOME=$PWD/.scratch/cargo ... --offline`.)

Layout:

```
extension.toml            # manifest: grammar + language server registration
Cargo.toml / src/         # Rust extension: downloads the LSP bundle + settings
grammar/                  # tree-sitter-openhab grammar (fork of tree-sitter-java)
languages/openhab/        # config.toml + tree-sitter queries (.scm)
server/                   # Node LSP server source + committed bundle (downloaded at runtime)
tests/                    # parse harness, fixtures, snapshots, validation scripts
```
