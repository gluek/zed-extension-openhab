# openHAB for Zed — status, architecture, and notes

A [Zed](https://zed.dev) language extension for [openHAB](https://www.openhab.org)
textual configuration files, ported from the
[openHAB VS Code extension](https://github.com/openhab/openhab-vscode) (which is
only read, never modified). It provides:

1. **Syntax highlighting**, bracket matching, auto-indent, code outline, and text
   objects for all openHAB file types, using a purpose-built tree-sitter grammar
   (`grammar/`, a fork of tree-sitter-java with openHAB DSL productions).
2. **Item-name completion** from a running openHAB instance, via a bundled
   language server (`server/`) that fetches `/rest/items` and follows the
   `/rest/events` stream for live updates.

## Status (2026-11-19)

Everything is **implemented and verified**:

- The extension is installed as a dev extension (symlinked from
  `~/.local/share/zed/extensions/installed/openhab`) and loads in Zed.
- The openHAB grammar parses all real configs in `/mnt/openhab/` with 0 ERROR
  nodes; highlighting (incl. strings, single-quoted strings, comments, numbers,
  keywords) verified visually in Zed and via the harness.
- The language server `openhab-lsp` starts under Zed (Node from
  `zed::node_binary_path()`, bundle embedded in the wasm), and item completion
  works against a live openHAB instance.

**In progress (uncommitted, 2026-11-19):** hover support — `textDocument/hover`
showing **only the live state** of the item under the cursor, prefixed with
`State: ` (e.g. `` State: `ON` ``, or `State: _(none yet)_` for NULL/UNDEF).
**Verified end-to-end** against a fake REST API over stdio
(`.scratch/lsp-probe-hover.py`, PASS: `hoverProvider: true` advertised; hovering
`Kitchen_Light` in a `.rules` body returns `State: \`ON\``; hovering a non-item
word returns null; `Kitchen_Temperature` returns `State: \`21.5\``).
Implementation: `server/src/hover.js` (`wordAt`/`hoverFor`), wired into
`Server.js`; 5 unit tests in `server/test/hover.test.js`, 29/29 pass; bundle
and extension wasm rebuilt. Remaining: visual check in Zed itself, then commit.

**Remaining work:** publish to personal GitHub — prepared in
`.scratch/grammar-publish/` (grammar repo layout: grammar.js, src/, queries/,
test/corpus/, tree-sitter.json, README) and `.scratch/PUBLISH.md` (runbook:
push `gluek/tree-sitter-openhab`, repoint `extension.toml` at it, push
`gluek/openhab-zed`, fresh-clone verify in Zed). Then the Zed marketplace via a
PR to `zed-industries/extensions`. Note: regenerate `src/parser.c` with
`tree-sitter generate` on a machine where the CLI works before pushing the
grammar repo — it fails in this sandbox.

## Caveats / known limitations

- **Zed does not load a grammar repo's `queries/` directory for extension
  grammars** — only the extension's own `languages/<name>/*.scm` are used. All
  needed highlight/outline/indent/textobject rules (including the Java-level
  ones for `.rules` bodies) live in `languages/openhab/*.scm`. This is why
  `highlights.scm` inlines the upstream tree-sitter-java rules instead of
  assuming they are compiled on top.
- **`'…'` strings in expression position parse as `character_literal`, not
  `single_quoted_string`** (longest-match lexer vs. the inherited Java token).
  Both are captured as `@string`, so highlighting is correct either way.
- **No `.persist` completion** — item names only inside its `Items { }` block;
  per-line detection was too false-positive-prone.
- Hover (`textDocument/hover`, 2026-11-19) resolves the identifier under the
  cursor against the live item cache and shows **only the state** as Markdown,
  prefixed with `State: ` (`` State: `ON` ``, or `State: _(none yet)_` when
  NULL/UNDEF); unknown words get no hover. Verified over stdio with a fake REST
  API; Zed visual check pending.
- Sitemap widget lines whose first attribute is not `item=`/`label=`/`icon=`
  (e.g. `Webview url="…"`) can mis-parse as `item_definition`. No active line in
  the real `home.sitemap` hits this.
- One cosmetic `MISSING ";"` in real configs: a bare assignment directly inside
  a `createTimer(…, [| … ])` call. Parse stays 0 ERROR.
- LSP was verified end-to-end against a fake REST API and a live instance, but
  only over `initialize → didOpen → completion`; no diagnostics (upstream's
  validator is a stub and was deliberately not ported).
- If the openHAB host uses an internal-CA TLS certificate, Node must trust that
  CA (system store or `NODE_EXTRA_CA_CERTS`); there is no
  `insecureSkipTlsVerify` option yet.

## Validation commands (run from the repo root `openhab-zed/`)

```
./tests/validate-queries.sh                                     # queries compile vs openHAB grammar: 5/5 PASS
./tests/check-snapshots.sh                                      # parse-tree snapshots: 20 ok, 0 changed
(cd server && node --test test/completion.test.js test/itemStore.test.js)   # LSP unit tests: 24 pass
export PATH=/home/zerotas/.local/share/zed/node/node-v24.22.1-linux-x64/bin:$PATH   # system node is broken here
CARGO_HOME=$PWD/.scratch/cargo cargo build --target wasm32-wasip2 --offline   # extension wasm build
```

(Use Zed's managed Node — `/usr/bin/node` is broken on this machine, missing
`libsimdjson.so.36`. `node --test test/` as a bare dir fails on this Node;
pass the test files explicitly. `integration.test.js` hangs — pre-existing.)

Harness build (openHAB grammar variant used by the scripts):

```
cd tests/harness && CARGO_HOME=../../.scratch/cargo CARGO_TARGET_DIR=../../.scratch/target-openhab \
  OPENHAB_ZED_GRAMMAR=openhab OPENHAB_GRAMMAR=$PWD/../../grammar/src cargo build --offline
```

(If the binary looks stale after regenerating `parser.c`, `rm -rf` the target
dir — cargo's `rerun-if-changed` does not always fire here.)

---

## Architecture

```
openhab-zed/
├── extension.toml                 # manifest: [grammars.openhab] + [language_servers.openhab-lsp]
├── Cargo.toml / src/openhab.rs    # Rust: language_server_command + settings plumbing
├── grammar/                       # tree-sitter-openhab grammar (fork of tree-sitter-java)
├── languages/openhab/             # config.toml + highlights/brackets/outline/indents/textobjects .scm
├── server/                        # bundled Node LSP server (see server/README.md)
└── tests/                         # parse harness, fixtures, snapshots, validation scripts
```

Key Zed constraints that shaped the design:

1. **Zed needs a tree-sitter grammar** — the VS Code TextMate grammar cannot be
   reused; all editor features are tree-sitter queries.
2. **Grammar key must match the exported C symbol.** Zed compiles with
   `-Wl,--export=tree_sitter_<key>`; our `parser.c` defines
   `tree_sitter_openhab`, so the key is `openhab`.
3. **The wasm sandbox only preopens the extension work dir** (`PWD` points at
   `~/.local/share/zed/extensions/work/openhab/`); the installed extension
   directory is not readable from wasm. So `src/openhab.rs` embeds the server
   bundle via `include_bytes!`, extracts it to `$PWD/openhab-language-server.js`
   on first use, and passes that absolute path to `node --stdio` (Zed spawns the
   server with the worktree root as CWD, not the extension dir).
4. **Zed ships its own Node.js** — `zed::node_binary_path()`, no runtime download.
5. **Settings flow both ways:** `language_server_initialization_options` (from
   `lsp.openhab-lsp.settings` in Zed's settings.json, defaults filled in Rust)
   and `language_server_workspace_configuration` (nested under the `openhab`
   section, which is what the server requests).

### Grammar (`grammar/`, committed)

Fork of `tree-sitter-java` (`name: 'openhab'`) covering all five openHAB
dialects. Verified: all real configs in `/mnt/openhab/` parse with 0 ERROR nodes.

Constructs added from the real configs:

- `.items`: fixed-order clauses (label, icon, groups, tags, `location_config`
  for `Location … [ latitude=… ]`, metadata); `aggregation_word` sub-segments
  (`Group:Number:AVG`); `aggregation_function` for `OR(OPEN, CLOSED)`.
- `.rules`/`.script`: `rule_declaration` + `trigger_condition`
  (`Item`/`Thing`/`System`/`Time`/`Channel`/`Member of`, `received command`,
  `changed from X to Y`); `[| … ]` lambdas as `oh_lambda` — single-token `[|`
  opener, the second `|` belongs to the optional parameter group; semicolon-less
  statements (`oh_call_statement` / `oh_field_call_statement` /
  `oh_method_call_statement`); `oh_var_declaration` (`val`/`var`, no `;`);
  `oh_as_cast` (`(x as T)` chains `.method()`); `single_quoted_string` as a full
  literal; `oh_map_entry` (`"k" -> "v"`) in argument lists.
- `.things`: `thing_uid` with colon/space-separated segments and `-` in the
  final segment; `bridge_body`; `channel_section` with unit-suffixed channel
  types (`Type number : temperature`).
- `.sitemap`: `sitemap_widget` accepts both `dsl_type_word` and `frame_word`
  (so a bare `Text item=…` line parses), plus the `[sitemap_frame,
  sitemap_widget]` conflict; `_oh_declaration` tries widget/frame before
  `item_definition`.
- `.persist`: newline-separated entries; `default = "…"` alias in Strategies.

Decisions worth keeping:

- **Shared type words**: one `dsl_type_word` token aliased per context
  (`item_type_base` / `sitemap_widget_type`); `Frame`/`Text` are a separate
  `frame_word` so they never compete with item types.
- **`end` is a keyword only in statement position.**
- **`repeat1(choice(...))` does not work** for the item tail (each clause is a
  distinct node) — the explicit optional sequence matches openHAB's fixed order.
- **The `conflicts:` list is long on purpose.** Many entries are reported
  "unnecessary" by `tree-sitter generate`, but removing any one re-triggers an
  "Unresolved conflict" at that exact parse state. Do not prune.
- Root cause of the old `.items` blocker: parse-state forking after
  `Switch A` (item_definition vs. Java statement); solved by declaring the
  conflicts so both versions are explored until the label arrives.

### Grammar mirror for local development

Zed **clones** the grammar `repository` and fetches the pinned `rev`, so a
`file://` path must be a real git repo whose root contains `grammar.js`/`src/`.
`.scratch/grammar-repo` is a git mirror of `grammar/`; `extension.toml` pins its
HEAD. After changing `grammar/`, run `./tests/make-grammar-mirror.sh` and pin
the printed rev (verify mode: `./tests/make-grammar-mirror.sh <pinned-rev>`).

### Query gotchas (apply to all `languages/openhab/*.scm`)

- This tree-sitter version rejects an anchor `(.)` between two sibling
  patterns (`Structure` error); anchors at the start of a pattern are fine.
- A predicate attached to an alternation `[(identifier) (type_identifier)] @x`
  is **silently ignored** — attach `#match?`/`#eq?` to a single node-type pattern.
- Predicates must follow all child patterns inside the group; a `#match?` must
  reference the capture it is attached to.
- Anonymous keyword tokens (`or`/`and` in trigger lists) cannot be captured
  under `trigger_condition` — match them as bare `"or" @keyword`.
- Zed's supported capture list excludes `@keyword.storage` and there is no
  `@namespace`; `@keyword.storage` is kept with `@keyword` as fallback capture,
  `@function.builtin` likewise after `@function.method`.

---

## Language server (`server/`)

Adapted from the VS Code extension's `serverJS` (~430 lines, vendored by hand).

```
server/
├── openhab-language-server.js   # committed esbuild bundle (~333 KB), embedded in the wasm
├── package.json                 # esbuild + 2 runtime deps, dev-time only
├── src/
│   ├── LSPServer.js             # entry point (keeps upstream's module shape)
│   ├── Server.js                # connection, settings, completion routing
│   ├── ItemStore.js             # REST seed + SSE stream, auth, reconnect
│   ├── Item.js                  # item model
│   ├── completion.js            # context rules + completion item building
│   └── files.js                 # extension/URI helpers
└── test/                        # node:test; 24 tests
```

The bundle is **committed**, so the extension needs no `npm install` at runtime
and no `node_modules` in the shipped artifact. Verified self-contained: with
`node_modules` moved away the server still answers `initialize` over stdio.

Deliberate deviations from the VS Code server:

| Upstream behaviour | Why it could not be ported | What this does |
|---|---|---|
| `createConnection(ProposedFeatures.all)` sniffs `--node-ipc` from argv | Zed passes `--stdio`; sniffing is unnecessary and fragile (and threw "Connection input stream is not set") | Explicit `createConnection(ProposedFeatures.all, process.stdin, process.stdout)` |
| `eventsource` package for the SSE stream | Extra dependency for a trivial `data:` line format; also mishandles openHAB's redirect | Node built-in `fetch` + manual line parsing |
| Plain `http://` only, no credentials | openHAB 4 uses API tokens | `authToken` (Bearer) and `basicAuth`, token wins; `host` accepts bare host, `host:port`, or full URL incl. `https://` |
| Settings only via `workspace/configuration` | Zed supplies the same object as `initializationOptions`; reading both avoids a race | `initializationOptions` first, then client config |
| Every item returned in every position (`TODO` in its own source) | Completion was useless in `.things` and inside strings | Scoped to `.items`/`.rules`/`.script`/`.sitemap`; suppressed in strings and comments |
| `itemCasing` setting | Only used by the "Create Items from Channels" *command*, which Zed has no equivalent for | Removed rather than shipped as dead config |
| `DocumentValidator` | A stub returning an empty array | Not ported; no diagnostics provider advertised |
| Errors `console.log`ged | Invisible in Zed | LSP `window/logMessage`, shown in Zed's log |

Behaviour verified: responds to `initialize` over stdio and advertises a
completion provider; unreachable openHAB → `cannot reach openHAB at …` log
message, process stays alive, retries every 10 s; end-to-end (fake REST API and
live instance): `.rules` document yields item names, the same position inside a
string literal yields none; SSE events handled: `ItemStateEvent`,
`ItemStateChangedEvent` (both openHAB 4 `{type, value}` and bare string),
`ItemAdded`, `ItemUpdated` (`[new, old]`), `ItemRemoved`; malformed payloads
tolerated.

**Hover (2026-11-19, verified over stdio):** `hoverProvider: true` is
advertised and `Server.getHover` resolves the identifier under the cursor
(`hover.wordAt`, using the same word characters as
`languages/openhab/config.toml`: alphanumerics plus `_`/`$`) against the live
`ItemStore` cache, returning **only the state** as Markdown, prefixed with
`State: ` (`` State: `ON` ``; `State: _(none yet)_` when NULL/UNDEF). Unknown
words return `null` (no hover). Probe: `.scratch/lsp-probe-hover.py` — reads
use `select()` with a deadline (a blocking `readline()` hung the first
version); polls completion to confirm the item cache seeded before hovering.
29/29 unit tests pass.

---

## Investigation log

### 2026-11-19 — LSP never started: relative bundle path in the wasm sandbox (fixed)

Zed's log showed `Failed to start language server "openhab-lsp" … bundle
(server/openhab-language-server.js) is missing`. The old code probed the
**relative** path with `std::fs::metadata`, which always failed: Zed runs
extension wasm with only the extension work dir preopened and `PWD` pointing at
it (see `crates/extension_host/src/wasm_host.rs` in the Zed source), and the
installed extension dir is not readable from the sandbox. Even with the probe
fixed, a relative path in `Command.args` would break again because Zed spawns
the server process with the worktree root as CWD. Fix: `include_bytes!` the
bundle, extract to `$PWD`, pass the absolute path. Verified in Zed's log:
`args: ["…/extensions/work/openhab/openhab-language-server.js", "--stdio"]`.

### 2026-11-19 — strings/comments/numbers not highlighted in `.rules` (fixed)

`highlights.scm` originally assumed tree-sitter-java's upstream
`queries/highlights.scm` is compiled on top of the grammar. It is not: Zed does
**not** load a grammar repo's `queries/` for extension grammars — only
`languages/<name>/*.scm`. So in `.rules` bodies, where strings are plain
`string_literal` nodes (not DSL nodes like `item_definition label:`), nothing
captured `@string`/`@comment`/`@number`. Verified with the harness: `rules-real.rules`
had 129 captures, zero `@string`; after adding the upstream rules the count is
163 incl. all strings; all 9 real `/mnt/openhab/rules/*.rules` files: 0 ERROR.

### 2026-11-19 — single-quoted strings still uncolored: `character_literal` (fixed)

After the fix above, `'…'` strings in `.rules` bodies were still plain. Root
cause: the grammar has a `single_quoted_string` token, but the lexer prefers the
**longest** match and Java's `character_literal` (`'…'`) matches the same text;
in expression position (`if (x.state == 'on')`, `logInfo("a", 'off')`) the
parser accepts `character_literal`, so the node is a char literal, not a string.
`single_quoted_string` only wins where `_oh_string` is expected (rule names,
cron, trigger states). Fix: capture `(character_literal) @string` too — in
openHAB files a char literal is always a DSL string. Verified: all 9 real
`/mnt/openhab/rules/*.rules` files 0 ERROR, with the `'…'` captures included
(e.g. `switches.rules`: 34 string + 18 char-literal captures).

### 2026-11-18 — harness + fixtures established

`tests/harness/` (Rust, tree-sitter 0.23) compiles the grammar's `parser.c` via
`build.rs` (env: `OPENHAB_ZED_GRAMMAR`, `<NAME>_GRAMMAR`, `<NAME>_SYMBOL`) and
provides `--tree`, `--captures <q.scm> <files…>`, `--compile <q.scm>`. Modes are
deterministic (captures sorted by row/col/kind/name). `tests/fixtures/` holds
`sample.*`, `r1..r5.rules` probes, `*-edge.*`, and `*-real.*` files sourced from
the real `/mnt/openhab` configs. `tests/trees/` pins parse trees only, so query
edits never churn snapshots. A scratch `CARGO_HOME` (`.scratch/cargo`) is needed
because `~/.cargo` is read-only.

### Environment notes (this machine)

- tree-sitter CLI 0.24.7 at `.scratch/ts-cli/node_modules/tree-sitter-cli/tree-sitter`
  (gitignored). NOTE: `tree-sitter generate` currently fails to load
  `grammar.js` under both available Node runtimes (DSL globals missing with the
  Zed node; `/usr/bin/node` is broken, missing `libsimdjson.so.36`) — regenerate
  `parser.c` only from an environment where the CLI works.
- `tree-sitter build` fails in-sandbox (read-only cache); compile via the
  harness's `cc` build instead. `~/.cargo` and `~/.npm` are read-only — always
  use the `.scratch` paths. Git writes need `unsandboxed: true` on the terminal
  call. `/tmp` is wiped between terminal calls — keep probes in
  `.scratch/probes/`.
