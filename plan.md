# Plan: Zed language extension for openHAB

Port the openHAB Visual Studio Code extension into a **Zed language extension** that provides:

1. **Syntax highlighting** (and the closely-coupled editor features: bracket matching, auto-indent, outline)
2. **Auto-complete** (items from a running openHAB instance).

The working directory for the new extension is [`zed/openhab-zed/`](zed/openhab-zed/) — scaffolded, installed as a **dev extension** and highlighting works in Zed. The existing VS Code extension is left untouched; we only *read* from it.

**Status:** Phase A (scaffold + syntax highlighting) is **done and verified in Zed**, and the query files were **rewritten and validated against a parse-tree harness** (`tests/`), which fixed the `.rules` keyword and outline problems (§9). **Item completion works** — the bundled language server is built, tested end-to-end, and shipped (§10). **Phase B** (purpose-built grammar) is **committed as `ac16be1`** and parses all 18 real configs in `/mnt/openhab/` **plus the `.sitemap` with 0 ERROR nodes** (sitemap fix in `d022b00`). Real-syntax fixtures added (`dab004f`) and **all five `languages/openhab/*.scm` queries rewritten for the new node names and validated against the openHAB grammar** (`c4dbb09`; `validate-queries.sh` 5/5 PASS, snapshots 20 ok / 0 changed). **Not yet active** — `extension.toml` still points at `tree-sitter-java`; the remaining steps are the key flip + wasm build + visual check, committed atomically (§11).

**Quick reference — validation commands (run from the repo root `openhab-zed/`):**

```
./tests/validate-queries.sh                                     # queries vs openHAB grammar: 5/5 PASS (OPENHAB_ZED_GRAMMAR=java for the Phase A baseline)
./tests/check-snapshots.sh                                      # 20 ok, 0 changed
(cd server && npm --cache ../.scratch/npm-cache test)            # LSP: 23 pass
CARGO_HOME=$PWD/.scratch/cargo cargo build --target wasm32-wasip2 --offline   # extension wasm build
# openHAB grammar harness (see §11 for the full env):
cd tests/harness && CARGO_HOME=../../.scratch/cargo CARGO_TARGET_DIR=../../.scratch/target-openhab \
  OPENHAB_ZED_GRAMMAR=openhab OPENHAB_GRAMMAR=$PWD/../../grammar/src cargo build --offline
```

---

## 1. What the VS Code extension actually provides

Findings from auditing the current repo (these drive the decisions below):

| Capability | Where it lives today | Notes |
|---|---|---|
| Language id / file associations | [`package.json`](package.json) `contributes.languages` | One language `openhab` covering `.rules .script .items .sitemap .things .persist` |
| Comments, brackets, auto-close | [`meta/language-configuration.json`](meta/language-configuration.json) | `//` line comments, `/* */` blocks, `{} [] () "" ''` pairs |
| **Syntax highlighting** | [`meta/openhab.tmLanguage.json`](meta/openhab.tmLanguage.json) | **TextMate** grammar (~24 KB, 122 captures). Zed cannot consume TextMate grammars. |
| Auto-complete (items) | [`serverJS/src/Server.js`](serverJS/src/Server.js), [`serverJS/src/ItemCompletion/ItemCompletionProvider.js`](serverJS/src/ItemCompletion/ItemCompletionProvider.js) | Node LSP server: fetches `/rest/items`, streams `/rest/events` (SSE) for live updates, returns *every* item as a completion (marked `Item` kind). No context awareness yet. |
| Snippets | [`snippets/*.json`](snippets/) | ~85 VS Code snippets for items / rules / sitemaps / things — **out of scope, not ported** |
| Validation | [`serverJS/src/DocumentValidation/DocumentValidator.js`](serverJS/src/DocumentValidation/DocumentValidator.js) | Out of scope for this plan (nice follow-up) |

The server is a plain `vscode-languageserver` Node process (stdio by default, `--node-ipc` in VS Code). That matters for Zed integration (see §5).

---

## 2. Key Zed constraints (from [`zed_extension.md`](zed_extension.md))

These are the decisions that shape the rest of the plan:

1. **Zed needs a tree-sitter grammar** — the TextMate grammar cannot be reused. All highlighting, brackets, outline, indent, and text objects are tree-sitter queries (`highlights.scm`, `brackets.scm`, `outline.scm`, `indents.scm`, …).
2. **No native tree-sitter grammar for openHAB rules DSL exists.** Only [`nicholascioli/tree-sitter-openhab-thing`](https://github.com/nicholascioli/tree-sitter-openhab-thing) exists, and it covers *only* `.things` files.
3. openHAB's real syntax is **Java-like** for every file type (`.items`/`.things`/`.sitemap`/`.persist` are a constrained subset, `.rules` is Java 8 + openHAB extensions).
4. A Zed **language server** is a Rust extension binary started via `language_server_command`. Zed speaks LSP over **stdio** (or socket).
5. Extension layout is fixed: `extension.toml`, `languages/<lang>/config.toml`, query files, optional `Rust` `Cargo.toml` + `src/lib.rs`.

---

## 3. Proposed architecture

Two-phase delivery, so we get a usable extension quickly without blocking on a hand-written grammar.

```
zed/openhab-zed/
├── extension.toml                 # extension manifest: grammar, languages, language_servers
├── Cargo.toml / src/openhab.rs    # Rust: language_server_command + initialization_options
├── languages/
│   └── openhab/
│       ├── config.toml            # name, grammar, path_suffixes, line_comments, brackets, overrides
│       ├── highlights.scm
│       ├── brackets.scm
│       ├── outline.scm
│       ├── indents.scm
│       └── textobjects.scm
└── server/                        # packaged LSP server (built from ../serverJS)
```

### Grammar strategy

**Phase A — reuse a Java grammar (fast, high quality baseline).** ✅ *implemented*
- Point the grammar entry at `tree-sitter-java` (pinned `rev`), then ship openHAB-specific `highlights.scm` overrides/additions on top.
- **The grammar key in `extension.toml` must be `java`, not `openhab`.** Zed compiles grammars with `-Wl,--export=tree_sitter_<key>`, derived from the manifest key; `tree-sitter-java`'s `parser.c` only defines `tree_sitter_java`. Naming the key `openhab` fails at link time with `symbol exported via --export not found: tree_sitter_openhab`. The key does **not** affect the parse tree, so all queries are key-agnostic (only `#match?`/`#eq?`/`#set!` names would need to change).
- Covers `.rules` well (they *are* Java): keywords, strings, numbers, comments, method calls, `if/else`, lambdas, imports.
- `.items`, `.things`, `.sitemap`, `.persist` parse "as best they can"; the editor will not show red error squiggles in Zed (highlighting tolerates ERROR nodes), so this is perfectly acceptable for v1.
- **Pros:** zero grammar authoring, good highlighting, indentation/bracket queries come nearly free.
- **Cons:** DSL-specific constructs (`Item Kitchen_Light "Label" <icon> (Group) ["tag"] { channel="..." }`, `when ... then ... end`, `<` → `>` sitemap syntax) won't be uniquely highlighted.

**Phase B — replace with a purpose-built `tree-sitter-openhab` grammar.** *(in progress; milestone 4 — see §11)*
- Author a grammar that handles the four DSL dialects. Recommended approach: **fork `tree-sitter-java`** and add external/DSL productions, rather than starting from scratch.
  - `.items` / `.persist`: line-oriented, easy.
  - `.things`: combine with `tree-sitter-openhab-thing` ideas (Bridge/Thing/Channel/UUID blocks).
  - `.sitemap`: `sitemap name label { Frame { ... } }`, `<`/`>` icon delimiters need an `extras`/external `icon` token — this is the trickiest part.
  - `.rules`: Java + `when/then/end`, `val`/`var`, UoM (`Number:Temperature`).
- Keep the language registry pointing at a single grammar name (`openhab`) so switching A→B is a one-line `extension.toml` + query change. *(Phase A currently uses the `java` key; Phase B switches both the key and `config.toml`'s `grammar`.)*
- **Validation:** test both variants against a corpus of real files (collect sample `.items`/`.rules`/`.things`/`.sitemap`/`.persist` into `tests/fixtures/`). Zed itself has no CLI highlighter; verify visually via `zed: open language extension` dev flow and/or `tree-sitter parse` / `tree-sitter highlight` on fixtures.

> Decision gate: finish Phase A end-to-end (highlight + completion) **before** investing in Phase B. Phase A is also the fallback if Phase B stalls.
>
> **Revisit at current status:** highlighting is done but visibly imperfect on `.rules`
> (see §7). If the missing `when` / ERROR-node noise is deemed unacceptable, move
> **Phase B (milestone 4)** ahead of **LSP packaging (milestone 2)** — it is the
> change that actually fixes `.rules`, whereas the LSP only adds completion.

---

## 4. Syntax highlighting deliverables

For `languages/openhab/`:

- **`config.toml`** (translates [`meta/language-configuration.json`](meta/language-configuration.json)) — implemented as:
  ```toml
  name = "openHAB"
  grammar = "java"            # Phase A; becomes "openhab" in Phase B
  path_suffixes = ["rules", "script", "items", "sitemap", "things", "persist"]
  line_comments = ["// "]
  tab_size = 4
  word_characters = ["_", "$"]          # item/thing names use underscores
  autoclose_before = ";:.,=}])>"
  brackets = [ … { } [ ] ( ) " " ' ' … ]

  [overrides.string]
  completion_query_characters = ["_", "$"]
  ```
  Also map the block comment `/* */` via the grammar; Zed needs no extra config for it.
- **`highlights.scm`** — map grammar nodes to Zed capture names (`@keyword`, `@string`, `@number`, `@comment`, `@function.method`, `@type`, `@constant.builtin`, `@punctuation.bracket`, …). Derive the mapping from the captures in `meta/openhab.tmLanguage.json` (e.g. `keyword.other.*`, `entity.name.package.openhab`, `variable.language.extension.openhab`, `punctuation.terminator.openhab`).
  - Phase A: start from `tree-sitter-java`'s `highlights.scm`, then **add** rules for openHAB keywords/units from the repositories `keywords`, `constants-and-special-vars`, `values`, `primitive-types`, `object-types` in the TextMate file.
- **`brackets.scm`** — `("{" @open "}" @close)`, `("[" @open "]" @close)`, `("(" @open ")" @close)`.
- **`outline.scm`** — `(method_declaration name: (identifier) @name) @item`, `(class_declaration …) @item`, `(import_declaration …) @item`; Phase B adds `(item_definition …)`, `(thing_definition …)`, `(rule_definition …)`, `(sitemap_definition …)`.
- **`indents.scm`** — indentation ranges for `block`, `class_body`.
- **`injections.scm`** (optional) — inject `comment` highlighting; nothing else needed.
- **`overrides.string.completion_query_characters`** — include `_` so item-name completion works while typing mid-identifier.

---

## 5. Auto-complete deliverables

Two sources of completions; ship the second regardless of the first.

### 5.1 Language server (context-aware, live) — the only completion source

Reuse the existing Node LSP server, with small refactors so it runs under Zed as a stdio child process:

1. **Transport:** Zed launches the server binary and talks stdio. Today [`serverJS/src/LSPServer.js`](serverJS/src/LSPServer.js) → `createConnection(ProposedFeatures.all)` auto-detects `--node-ipc` from VS Code. Ensure stdio is used when no IPC arg is present (or always pass stdio explicitly in Zed — the Rust side already passes `--stdio`).
2. **Language id:** Zed sends `languageId` from its `languages` name unless mapped. Add to `extension.toml`:
   ```toml
   [language_servers.openhab-lsp.language_ids]
   openHAB = "openhab"
   ```
   (keeps parity with VS Code).
3. **Configuration:** VS Code pushes settings through `workspace/configuration` + `didChangeConfiguration`. In Zed this is driven by `initialization_options` from Rust's `language_server_initialization_options`:
   - `host`, `port` (default `localhost:8080`), `authToken` / `basicAuth`, `itemCasing`.
   - Defaults are filled in Rust; users override via `lsp.openhab-lsp.settings` in Zed's settings.json.
   - The server must tolerate `didChangeConfiguration` never being called and instead use `initializationOptions` from `initialize`.
4. **Completion quality improvements (small, high value):**
   - Return completion **only** in valid positions (`.items` after type, inside rule bodies / `Item` context) rather than everywhere (the existing `TODO` in `Server.js`).
   - Add `CompletionItemKind`, `detail` (item type), and `documentation` (state).
   - Respect `itemCasing` setting.
5. **Distribution:** Zed ships its own Node.js. Use `zed::node_binary_path()` — **no runtime download needed**. Still need to ship the compiled server bundle (`serverJS/out`):
   - **(a)** Ship `server/LSPServer.js` + `node_modules` inside the extension, or fetch them into the work dir on first run (`zed::download_file`).
   - **(b)** Rewrite the server in Rust (later; larger effort, better startup).
   - Pick **(a)** for v1. During development the extension reads the sibling `../serverJS/out/LSPServer.js` from this repo.
   - **Implemented:** `src/openhab.rs` resolves `zed::node_binary_path()` + `server/openhab-language-server.js`, passes `--stdio`, and supplies `initialization_options` / `workspace/configuration` with defaults (`host`, `port`, `authToken`, `basicAuth`, `lspEnabled`). The bundle is committed, so no download or `npm install` happens at runtime.
6. **Robustness:** if openHAB is unreachable the server logs an LSP message (visible in Zed's log) and retries every 10 s; it never crashes. A missing bundle produces a clear `language_server_command` error.

---

## 6. Open questions / decisions to confirm

1. **Split languages?** One `openhab` language (matches VS Code) vs. separate `openHAB Rules` / `openHAB Items` / … languages (better per-type queries, but grammar duplication and 6 registrations). **Proposal:** stay with one language for v1.
2. **Phase B grammar ownership:** fork in this repo (`zed/vendor/tree-sitter-openhab`) vs. upstream a new repo and pin by `rev`. **Proposal:** prototype locally, publish as `openhab/tree-sitter-openhab` before release.
3. **Remote openHAB** (auth token, HTTPS) — the server currently uses `http://host:port` only (`ItemCompletionProvider`). Support `authToken` for openHAB 4 instances as a follow-up.

---

## 7. Work breakdown / milestones

| # | Milestone | Output | Validation |
|---|---|---|---|
| ✅ 0 | Scaffold `zed/openhab-zed` | `extension.toml`, `Cargo.toml`, `src/openhab.rs`, `languages/openhab/config.toml` | `cargo check` clean; **builds to `wasm32-wasip2`; installed & loaded in Zed** |
| ✅ 1 | **Phase A highlighting** via `tree-sitter-java` | `highlights.scm`, `brackets.scm`, `indents.scm`, `outline.scm`, `textobjects.scm` | `tests/validate-queries.sh` green; captures verified on fixtures; **confirmed visually in Zed ("okayish")** |
| 2 | **LSP packaging** | ✅ *done* — `server/` ships a bundled Node server; stdio; `initializationOptions` + `workspace/configuration` | 23 tests green, incl. end-to-end against a fake openHAB; response verified over stdio |
| 3 | **LSP completion polish** | ✅ *done with 2* — context-aware completion, type/state docs, auth | Unit + integration tests (`server/test/`) |
| 4 | **Phase B grammar** | ✅ *committed `ac16be1`* — `grammar/` parses all 18 real `/mnt/openhab` files with 0 ERROR; `.sitemap` ERRORs fixed in `d022b00` (home.sitemap now 0 ERROR) | `tree-sitter parse` clean on real files; harness in `tests/harness` |
| 5 | **Phase B switch** | 🟨 *partly done* — fixtures (`dab004f`) + `.scm` rewrite for new node names (`c4dbb09`, validated: 5/5 queries, 20/20 snapshots) are committed; remaining: `extension.toml` `[grammars.openhab]` key flip + `config.toml` `grammar = "openhab"` + wasm build | `validate-queries.sh` + `check-snapshots.sh` + wasm build green; visual check in Zed (§11 remaining steps) |
| 6 | Docs + release | `zed/README.md`, CI to build Rust target matrix, grammar rev pin | CI green |

### Current known limitations (Phase A)

- **`.rules` highlighting is partial.** `rule`/`when`/`then`/`end` highlight when
  their tokens survive as named nodes, which depends on how the rule body recovers
  from parse errors; `.rules` files produce many `ERROR` nodes regardless (§9).
  Rule headers are only outlined in files whose triggers keep them parseable.
- `.items` / `.things` / `.sitemap` / `.persist` are line-oriented and highlight
  acceptably; `.things` and `.persist` are mostly `ERROR` nodes by nature.
- **The language server is bundled and tested**, but is only proven against a fake openHAB REST API, not a live instance (§10).

### Environment prerequisites (verified on this machine)

- Rust via **rustup** with the `wasm32-wasip2` target (a distro `rustc` alone is not
  enough; Zed only auto-installs the target when `rustup` is present).
- Zed downloads the **WASI SDK** itself on first grammar build.
- Zed's `grammars/`, `target/` and `extension.wasm` are build artifacts — gitignored.

### Phase A implementation notes (learned while validating)

- openHAB DSL words (`rule`, `when`, `sitemap`, `val`, `var`, ...) are **not** Java
  keywords, so the grammar produces no string nodes for them. They are matched by
  content with `#match?` on `identifier` / `type_identifier` instead.
- The same word can appear as **either** node type depending on position: `when`
  parses as a `type_identifier` in a rule body, `val`/`var` as `type_identifier`
  when they start a declaration, but as `identifier` elsewhere. Keyword and
  storage-modifier rules therefore match **both** node types.
- A `#match?` predicate must reference the capture it is attached to. Naming a
  different capture silently disables the filter and matches every node of that
  type (this bit the outline query during development).
- File suffixes `.rules`/`.script` share the same grammar; only `line_comments`
  and bracket config are language-wide.
- The grammar has **no** `comment` node — only `line_comment` / `block_comment`.
- `.rules` files produce many `ERROR` nodes around `when`/`then` rule bodies.
  Highlighting and brackets still work (Zed tolerates ERROR nodes); Phase B fixes
  the parse. `.items` / `.things` / `.sitemap` / `.persist` are line-oriented and
  parse mostly as expression statements.
- **Validating queries:** `tree-sitter query <file>.scm <fixture>` needs a compiled
  grammar in the grammar checkout (`tree-sitter build`). Beware: results can be
  misleading if the CLI is pointed at a stale/cached grammar — rebuild after
  changing `parser.c`, and probe with a minimal file where the token stands alone.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| No tree-sitter grammar → can't reuse TextMate | Phase A uses `tree-sitter-java`; Phase B builds one |
| Java grammar mis-parses DSL files | Highlighting degrades gracefully; Phase B fixes. **Observed:** `when` missed in bare `rule` headers |
| Grammar key must match the exported C symbol | Key is `java`; Phase B's own grammar must export `tree_sitter_openhab` |
| Server bundle missing at runtime | Fail gracefully; document `server/` layout |
| LSP was VS Code–specific (`workspace/configuration`) | Switch to `initializationOptions`; test under Zed |
| Sitemap `<`/`>` syntax hard to lex | Use `extras`/external token in Phase B grammar |
| Query changes made blind (no local parser run) | Validate every query against a local tree-sitter harness + fixtures (§9) |

---

## 9. Investigation log

### 2026-11-18 — local parse harness + fixtures

Built a throwaway harness to inspect what `tree-sitter-java` **actually** produces for
openHAB files, because Phase A notes (§7) were partly derived from `syntax_tree` output
and were misleading in places. It has since been **promoted into the repo** at
`tests/harness/` (see the entry below), so this section describes its origin.

- `tests/harness/` (was `zed/openhab-zed/.scratch/tsh/`) — Rust binary using
  `tree-sitter` 0.23; `build.rs` compiles the vendored `grammars/java/src/parser.c`.
  Modes: default/`--tree` (parse tree), `--captures <q.scm> <files…>` (captures mapped
  onto source lines), `--compile <q.scm>` (query validation only). A scratch
  `CARGO_HOME` (`.scratch/cargo`) is needed here because `~/.cargo` is read-only.
- `tests/fixtures/` (was `.scratch/fixtures/`) — `sample.{items,rules,things,sitemap,persist}`,
  `r1..r5.rules` probes, plus `*-edge.*` fixtures added later.

Observations worth folding into the queries / plan:

1. **`import` needs a delimiter.** `import a.b.C` (no `;`) produces a proper
   `import_declaration` **only if the parser can run to EOF** — i.e. the next
   statement must be on a later line with a blank line in between. With a statement
   right after it, the whole import turns into an `ERROR`. Real openHAB files are
   usually safe, but the import cannot be highlighted reliably in all layouts.
2. **`.items` channel values are not strings.** `channel="hue:…:color"` inside
   `{ … }` parses as `ERROR` / `expression_statement` / `assignment_expression`, so
   only *label* strings get `@string`. Same for `(Group)` (which does parse as
   `parenthesized_expression` → `identifier`).
3. **`.sitemap` widget types are `type_identifier`** (`Switch`, `Frame`, `Dimmer`, …)
   at the start of a line — usable. But openHAB `Text` items collide with the
   `Text` widget, and most of a widget line after the first `=` collapses into a
   single `ERROR`, so per-parameter coloring is not feasible in Phase A.
4. **`.things` / `.persist` are near-total `ERROR`.** Only isolated fragments are
   structured; anything beyond string/number/comment highlighting needs Phase B.
5. **`end` is never a token.** It always ends up inside an `ERROR` node, so
   `decrease_indent_pattern = "^\\s*end\\b"` in `config.toml` is inert at best and
   would also apply to `.rules` code containing `end`-prefixed identifiers.
6. **Unanchored queries double-match.** e.g. `(method_declaration name: …)` fires
   again for nested `method_invocation`/`identifier` nodes because there is no `;`
   guard; several predicates re-search whole subtrees.
7. **Keyword rules hit names.** Confirmed on `sample.rules` and `sample.items`: the
   `^(rule|when|then|end|…)$` rules fire on *any* identifier with those contents, so
   an item named e.g. `Channel` reads as a keyword. The same words are also
   `type_identifier`s more often than the old file assumed (`end`, `then`, `val`).
8. **`import` needs supporting rules.** In `sample.rules`, `import org.eclipse…ScriptServiceUtil`
   yields package segments as `@variable` and the final type as `@variable` — the
   last segment should be `@type`, the prefix `@variable`/namespace.
9. **`outline.scm` catches nothing.** `((identifier) @name (#match? …)) @item`
   captured **zero** items on `sample.sitemap` and `sample.things`, and on
   `sample.rules` matched header words rather than names. Rule names live in a
   sibling `string_literal`, and `Frame label="…"` parses as a
   `local_variable_declaration` whose `value:` is the label string.
10. **`ON`/`OFF` need an explicit builtin list.** They are `identifier`s (not
    `constant` nodes) and some lack a preceding `;`, so they resolve as `@variable`
    and are not matched by the `@constant`/`@constant.builtin` rules.

### 2026-11-18 — parallel query work: what worked, what didn't

The remaining query work (`highlights.scm`, `outline.scm` + `indents.scm`, and the
`tests/` scaffolding) was split across three sub-agents with disjoint write scopes.
**Only the `tests/` agent produced useful, reusable output**; the two GLM agents were
stopped before making any edits, so **`languages/openhab/*.scm` are still unchanged
from the original commit**. What survives from the delegation:

- `tests/harness/` — kept, and fixed by hand: the generated `build.rs` did not
  compile (broken multi-line string) and `main.rs` had a `sort_by_key` lifetime
  error. Both are repaired; all five queries currently `--compile` clean.
- `tests/fixtures/` — kept: the `sample.*`/`r*` probes plus new `items-edge.items`
  (every base item type, `Group:Number:AVG`/`:SUM`, metadata blocks), `rules-edge.rules`
  (cron / `System started` / `changed to ON` / channel triggers, `script`, top-level
  `val`/`var`, lambdas, imports with and without `;`), `sitemap-edge.sitemap`,
  `things-edge.things`, `persist-edge.persist`.
- **Still missing:** `tests/trees/` snapshots (directory exists but is empty),
  `tests/validate-queries.sh`, `tests/update-snapshots.sh`, `tests/reports/`,
  `tests/README.md`, and the `.gitignore` entries for `.scratch/` and
  `tests/harness/target`.

Lesson for delegation: an agent exploring an unfamiliar parse tree burns most of its
budget on discovery before it writes anything. Give such an agent the *tree dumps*
as input (or a pre-written failing test), not just the task description.

Next (single-agent work): finish `tests/` scaffolding, then do the query edits
(`highlights.scm` anchoring + keywords-in-name-position + `import` + `ON`/`OFF`;
`outline.scm` headers-by-string; `indents.scm` review), validating each with
`tests/harness` before calling it done.

### 2026-11-18 — queries rewritten and validated (Phase A polish done)

All five query files were rewritten against real parse trees and validated with
`tests/harness`. `tests/validate-queries.sh` passes, `check-snapshots.sh` is green,
and the extension still builds to `wasm32-wasip2`.

**Tooling.** The harness gained `--compile` (query validation with no fixtures) and
the scripts `validate-queries.sh`, `update-snapshots.sh`, `check-snapshots.sh`,
`report-captures.sh`. `tests/trees/` pins **parse trees only**, so query edits never
churn snapshots.

**Ground rules discovered while writing queries** (these cost most of the time and
are worth reading before touching a `.scm`):

1. **This tree-sitter version rejects an anchor `(.)` between two sibling
   patterns** (`Structure` error). `(a) (.) (b)` does not compile; `(a) (b)` does.
   Anchors at the *start* of a pattern compile fine. Plan queries accordingly.
2. **A predicate attached to an alternation `[(identifier) (type_identifier)] @x`
   is silently ignored** — the capture then matches every node of those types.
   Always attach `#match?`/`#eq?` to a single node-type pattern.
3. **Predicates must follow all child patterns** inside the group.
4. **Top-level bare identifiers are not valid Java.** `program` accepts only
   `method_declaration` and `statement`, so `rule` is only an `expression_statement`
   when the header is absorbed into a statement context. In `sample.rules` that
   happens for the `Item … changed` triggers but not for `Time cron` or
   `Channel … triggered`.
5. **A semicolon-less `import` swallows the rest of the file** into one ERROR node
   whenever another statement follows (blank lines and comments do not help).
   `r1.rules` and `r5.rules` are therefore deliberate worst-case fixtures.
6. **Zed's supported capture list excludes `@keyword.storage`** and there is no
   `@namespace`. `@keyword.storage` is kept (as the original file did) with
   `@keyword` as the fallback capture; `@function.builtin` is likewise not in the
   table but is used as a fallback after `@function.method`.

**What changed per file.**

- `highlights.scm` — upstream `tree-sitter-java` queries already cover variables,
  methods, literals, comments and Java keywords, so the duplicate rules were
  dropped (two rules per node made theme resolution arbitrary). Added: `@function`
  fallback, `import` final-segment `@type`, `labeled_statement` → `Group:Number:AVG`
  segment types, rule-trigger vocabulary, `,`/`;` delimiters. Confirmed that the
  DSL keyword rules no longer fire on item/thing *names*.
- `outline.scm` — sitemap (`sitemap`/`Frame` by label) and `.items` groups now work;
  `enum`/`constructor`/`record` added (`tags.scm` covers classes/methods/interfaces
  only, and runs alongside this file). Rule headers remain unreachable in most files
  (ground rule 4) and are documented as such.
- `indents.scm` — `switch_block` added, `@start.if` marker added. **Bug fixed:** the
  new `decrease_indent_patterns` initially landed *under* `[overrides.string]`, which
  is invalid; it is now a top-level key.
- `textobjects.scm` — `(block) @function.around` added (blocks are the only reliable
  body node in openHAB files).
- `config.toml` — `decrease_indent_patterns` for `else` alignment; no `end` pattern
  (inert at best, risky at worst).

**Bugs found and fixed in the promoted harness:** `build.rs` did not compile
(broken multi-line string) and `main.rs` had a `sort_by_key` lifetime error.
The scaffold script also hid query failures (`--compile` output went to `/dev/null`)
and put backslashes in fixture files (r1–r5); `report-captures.sh` was added because
nothing regenerated `tests/reports/`.

**Still open.** `ON`/`OFF` stay `@variable` (finding 10); `Number:Temperature`
`:Temperature` stays `@variable`; rule headers are not outlined in most files. All
three are Phase B items, not Phase A regressions.

### 2026-11-18 — Phase B activated in the test harness (fixtures + queries + sitemap)

- `dab004f` — five `tests/fixtures/*-real.*` files sourced from the real
  `/mnt/openhab` configs (aggregation functions, `Member of(…)`,
  `received command`, `changed from/to`, `Type number : temperature`, bridge
  body on next line, `[| … ]` lambdas, `Thread::sleep(…)`, `var Timer x`,
  `(x as T).m()`, single-quoted strings, `Location [ latitude=… ]`, persist
  wildcards/`default`). All parse with **0 ERROR** under the openHAB grammar.
  Probing during fixture authoring surfaced grammar quirks now documented in
  §11: `Member of` needs the parenthesized form, and `x = createTimer(…,
  [| … ])` as a bare assignment trips the known cosmetic `MISSING ";"`
  (`val t = createTimer(…)` is clean).
- `d022b00` — `.sitemap` fix (see §11 "Sitemap fix"): `home.sitemap` now
  **0 ERROR** (was 9). Root cause: `frame_word` was only consumable by
  `sitemap_frame` (which requires a body), so a bare `Text item=…` sibling
  had no production. `sitemap_widget` now accepts `frame_word` too, plus the
  `[sitemap_frame, sitemap_widget]` conflict and reordering in
  `_oh_declaration`.
- `c4dbb09` — all five `languages/openhab/*.scm` rewritten for the new node
  names and validated with the openHAB harness **before** any flip:
  `validate-queries.sh` 5/5 PASS, snapshots regenerated 20 ok / 0 changed,
  capture reports regenerated (100 files). Test scripts default to the openHAB
  grammar now (`OPENHAB_ZED_GRAMMAR=java` selects the Phase A baseline).
  Gotchas re-confirmed: predicates on alternations are silently ignored
  (outline rules attach `#match?`/`#not-match?` to the single
  `sitemap_widget_type` capture); anonymous keyword tokens (`or`/`and`) cannot
  be captured under `trigger_condition` and are matched as bare `"or" @keyword`.

---

## 10. Language server implementation (milestones 2 + 3)

Adapted from `../openhab-vscode/serverJS` (~430 lines total, vendored by hand —
the VS Code extension is only read, never modified).

### Layout

```
server/
├── openhab-language-server.js   # committed esbuild bundle (~326 KB), the thing users run
├── package.json                 # esbuild + 2 runtime deps, dev-time only
├── src/
│   ├── LSPServer.js             # entry point (keeps upstream's module shape)
│   ├── Server.js                # connection, settings, completion routing
│   ├── ItemStore.js             # REST seed + SSE stream, auth, reconnect
│   ├── Item.js                  # item model
│   ├── completion.js            # context rules + completion item building
│   └── files.js                 # extension/URI helpers
└── test/                        # node:test; 23 tests
```

The bundle is **committed** so the extension needs no `npm install` at runtime and
no `node_modules` in the shipped artifact. Verified self-contained: with
`node_modules` moved away the server still answers `initialize` over stdio.

### Deliberate deviations from the VS Code server

| Upstream behaviour | Why it could not be ported | What this does |
|---|---|---|
| `createConnection(ProposedFeatures.all)` sniffs `--node-ipc` from argv | Zed passes `--stdio`; sniffing is unnecessary and fragile | Explicit stdio (no transport arg) |
| `eventsource` package for the SSE stream | Extra dependency for a trivial `data:` line format; also mishandles openHAB's redirect | Node built-in `fetch` + manual line parsing |
| Plain `http://` only, no credentials | openHAB 4 uses API tokens | `authToken` (Bearer) and `basicAuth`, token wins |
| Settings only via `workspace/configuration` | Zed supplies the same object as `initializationOptions`; reading both avoids a race | `initializationOptions` first, then client config |
| Every item returned in every position (`TODO` in its own source) | Completion was useless in `.things` and inside strings | Scoped to `.items`/`.rules`/`.script`/`.sitemap`; suppressed in strings and comments |
| `itemCasing` setting | Only used by the "Create Items from Channels" *command*, which Zed has no equivalent for | Removed rather than shipped as dead config |
| `DocumentValidator` | A stub returning an empty array | Not ported; no diagnostics provider advertised |
| Errors `console.log`ged | Invisible in Zed | LSP `window/logMessage`, shown in Zed's log |

### Behaviour verified

- Responds to `initialize` over stdio and advertises a completion provider.
- Unreachable openHAB → `cannot reach openHAB at host:port (…); item completion disabled`,
  process stays alive, retries every 10 s.
- End-to-end (fake REST API): `.rules` document yields the item names; the same
  position inside a string literal yields none.
- Event handling covers `ItemStateEvent`, `ItemStateChangedEvent` (both the
  openHAB 4 `{type, value}` shape and the older bare string), `ItemAdded`,
  `ItemUpdated` (`[new, old]`), `ItemRemoved`, and tolerates malformed payloads.

### Known gaps

- **Not tested against a live openHAB instance** — only a fake server. The SSE
  consumption path (chunked `data:` lines, redirect handling) is exercised
  against a stream that never sends events.
- **No `persist` completion.** `.persist` files do take item names inside
  `Items { }`, but per-line detection was too false-positive-prone; left out.
- **`itemCasing`-style features** (generating names from channels) remain absent.

---

## 11. Phase B — purpose-built grammar (milestone 4, COMMITTED as `ac16be1`)

Fork of `tree-sitter-java` in `grammar/` (`name: 'openhab'`, exports
`tree_sitter_openhab`), covering all five openHAB dialects. **Phase A remains
active** — `extension.toml` still points at `tree-sitter-java`; the flip is
deliberately a separate, atomic commit.

### Verified

- Fork point: regenerating the **unmodified** copy reproduces
  `grammars/java/src/parser.c` byte-identically, matching the `rev` pinned in
  `extension.toml`.
- **All 18 real configs in `/mnt/openhab/` (items/rules/things/sitemap) parse
  with 0 ERROR nodes and 1 cosmetic `MISSING ";"`** (a bare `wakeupTimer = null`
  assigned directly inside a `createTimer(…, [| … ])` call). `.sitemap` was
  fixed in `d022b00` (see "Sitemap fix" below).
- `tests/harness` is grammar-agnostic: `OPENHAB_ZED_GRAMMAR=<name>` +
  `<NAME>_GRAMMAR` (path to a `src/` dir) + `<NAME>_SYMBOL` select the parser,
  via a `build.rs`-generated symbol shim. Two builds coexist:
  `tests/harness/target` (Java) and `.scratch/target-openhab` (openHAB).
  Build the openHAB variant with:
  ```
  cd tests/harness && CARGO_HOME=../../.scratch/cargo \
    CARGO_TARGET_DIR=../../.scratch/target-openhab \
    OPENHAB_ZED_GRAMMAR=openhab OPENHAB_GRAMMAR=$PWD/../../grammar/src \
    cargo build --offline
  ```
  (If the binary looks stale after regenerating `parser.c`, `rm -rf` the
  target dir — cargo's `rerun-if-changed` does not always fire here.)
- Parse the real files either via the harness binary or the CLI:
  `XDG_CACHE_HOME=.scratch/xdg CARGO_HOME=.scratch/cargo .scratch/ts-cli/node_modules/tree-sitter-cli/tree-sitter parse <file>`
  run from `grammar/`. Regenerate after editing `grammar/grammar.js` with
  `tree-sitter generate` (same env). `/tmp` is wiped between terminal calls —
  keep probes in `.scratch/probes/`.

### Root cause of the old `.items` blocker (solved)

The mis-parse (`Switch A "L" <light> …` stopping after the name) was **not a
precedence problem** — `prec()` changes did nothing. It was **parse-state
forking**: after `Switch A` the parser had already committed to
`item_definition` in one version and to a Java statement in another, and the
label `"L"` had no valid continuation in the first. Solved by **declaring
conflicts** so both versions are explored until the label arrives:
`[$.item_definition, $.statement]`, `[$.item_type, $.sitemap_widget]`, plus
`[$.item_type, $.labeled_statement]` and friends. `Group:Number:AVG` needed
one more step: a dedicated `aggregation_word` token (`AVG`/`OR`/`SUM`/…) so
the `:` chain cannot be read as a Java labeled statement.

### Grammar constructs added from the real configs

- `.items`: fixed-order clauses (label, icon, groups, tags, `location_config`
  for `Location … [ latitude=… ]`, metadata); `aggregation_word` sub-segments;
  `aggregation_function` for `OR(OPEN, CLOSED)`.
- `.rules`/`.script`: `rule_declaration` + `trigger_condition`
  (`Item`/`Thing`/`System`/`Time`/`Channel`/`Member of`, `received command`,
  `changed from X to Y`); `[| … ]` lambdas as `oh_lambda` — **single-token
  `[|` opener and the second `|` belongs to the optional parameter group**
  (`[| body ]` has one pipe; `[| params | body ]` has two); semicolon-less
  statements `oh_call_statement` / `oh_field_call_statement` /
  `oh_method_call_statement`; `oh_var_declaration` (`val`/`var`, optional type
  word, no `;`); `oh_as_cast` (`(x as T)` as a primary, chains `.method()`);
  `single_quoted_string` as a full literal (not `character_literal`);
  `oh_map_entry` (`"k" -> "v"`) in argument lists.
- `.things`: `thing_uid` with colon- or space-separated segments and `-` in
  the final segment (`poweroutletA-control`); `bridge_body` for the `{ … }`
  block after a Bridge header; `channel_section` with unit-suffixed channel
  types (`Type number : temperature`).
- `.persist`: newline-separated (not comma) entries in both sections;
  `default = "…"` alias in Strategies.

### Grammar decisions worth keeping

- **Shared type words.** `.items` item types and `.sitemap` widget types use
  the same tokens; one `dsl_type_word` aliased per context
  (`item_type_base` / `sitemap_widget_type`) with `[$.item_type, $.sitemap_widget]`.
- **`Frame`/`Text` are separate** (`frame_word`) so they never compete with
  item types.
- **`end` is a keyword only in statement position.**
- **`.persist` splits by section** (`persist_strategies_section` vs
  `persist_items_section`).
- **`repeat1(choice(...))` does not work** for the item tail (each clause is a
  distinct node) — use the explicit optional sequence in openHAB's fixed order.
- **The `conflicts:` list in `grammar.js` is long on purpose.** Many entries
  are reported "unnecessary" by `tree-sitter generate`, but removing any one
  re-triggers an "Unresolved conflict" at that exact parse state. Do not prune.

### Environment notes

- tree-sitter CLI 0.24.7 lives at `.scratch/ts-cli/node_modules/tree-sitter-cli/tree-sitter`
  (gitignored; fetched from the GitHub release because the npm script's
  download was mangled by the proxy). Run it with `XDG_CACHE_HOME=.scratch/xdg`
  and `CARGO_HOME=.scratch/cargo`.
- `tree-sitter build` fails in-sandbox (read-only cache); compile via the
  harness's `cc` build instead. `~/.cargo` and `~/.npm` are read-only — always
  use the `.scratch` paths.
- Git writes need `unsandboxed: true` on the terminal call.

### Sitemap fix (committed `d022b00`)

The deferred `.sitemap` gap (9 ERRORs in `home.sitemap`) is **fixed**: a bare
`Text item=X label="…"` line inside a Frame had no valid production because
`frame_word` (`Frame`/`Text`) was only consumed by `sitemap_frame`, which
requires a `{ … }` body. Changes:

- `sitemap_widget` now accepts `choice($.dsl_type_word, $.frame_word)` as its
  widget token, so a bare `Text`/`Frame` line is a widget in any position.
- New conflict `[$.sitemap_frame, $.sitemap_widget]` (required by
  `tree-sitter generate` for the `frame_word … sitemap_body` ambiguity).
- `_oh_declaration` tries `sitemap_widget`/`sitemap_frame` before
  `item_definition` so a widget-shaped line wins over the item reading.

Result: `home.sitemap` and `sitemap-real.sitemap` parse with **0 ERROR nodes**.
Known remaining limitation (documented in the commit): a widget line whose
first attribute is not `item=`/`label=`/`icon=` (e.g. `Webview url="…"`) still
mis-parses as `item_definition` (`url` is a valid item name and the parser
commits before seeing `="…"`). No active line in the real `home.sitemap` hits
this (the `Webview url=…` lines there are commented out).

### Query rewrite (committed `c4dbb09`)

All five `languages/openhab/*.scm` files were rewritten for the new node names
and validated with the openHAB harness (`--compile` + `--captures` on all
fixtures) BEFORE the key flip, per the §9 gotchas:

- `highlights.scm` — DSL keywords are real tokens now (`rule`/`when`/`then`/
  `end`, trigger vocabulary, `val`/`var`, `as`); item types → `item_type_base`
  `@type.builtin`; sitemap widgets → `sitemap_widget_type`; config keys →
  `@property`; `ON`/`OFF`/`NULL`/`UNDEF` still via one content match on
  `identifier`; `->`/`::` → `@operator`. Anonymous keyword tokens (`or`/`and`)
  can't be captured under `trigger_condition` — matched as bare `"or" @keyword`.
- `outline.scm` — `rule_declaration` by name string; only `Group` items
  outlined; things/channels by uid/id; sitemap by name/label with widget type
  as `@context` (predicates attached to the single `sitemap_widget_type`
  capture, since predicates on alternations are silently ignored).
- `indents.scm` — `@indent`/`@end` for `rule_body`, `sitemap_body`,
  `bridge_body`, `thing_body`, `item_metadata`, `metadata_block`.
- `textobjects.scm` — DSL bodies `@function.around`, declarations `@class.around`.
- `brackets.scm` — unchanged.

`tests/{validate-queries,update-snapshots,check-snapshots,report-captures}.sh`
now default to the openHAB harness and accept `OPENHAB_ZED_GRAMMAR=java` for the
Phase A baseline. Snapshots regenerated with the openHAB grammar:
**20 ok, 0 changed**; `validate-queries.sh` **5/5 PASS**.

### Remaining work

1. ~~Grammar parses real configs~~ ✅ done (`ac16be1`).
2. ~~`.sitemap` polish~~ ✅ done (`d022b00`) — `home.sitemap` 0 ERROR.
3. ~~Extend `tests/fixtures/`~~ ✅ done (`dab004f`) — `*-real.*` fixtures cover
   `Group:Contact:OR(OPEN, CLOSED)`, `Member of(…)`, `received command`,
   `changed from X to Y`, `Type number : temperature`, bridge body on next
   line, `[| … ]` lambdas, `Thread::sleep(…)`, `var Timer x`, `(x as T).m()`,
   `'single-quoted'`, `Location … [ latitude=… ]`.
4. ~~Rewrite `languages/openhab/*.scm` for the new node names~~ ✅ done
   (`c4dbb09`, validated 5/5 + 20/20 before flipping).
5. **Flip `extension.toml` to `[grammars.openhab]`** (key must be `openhab` so
   the exported symbol is `tree_sitter_openhab`; point `repository` at the
   published `openhab/tree-sitter-openhab` rev — milestone 6 publishes it) and
   `config.toml`'s `grammar = "openhab"`.
6. **Re-verify**: `tests/validate-queries.sh` + `tests/check-snapshots.sh`
   (already green against the openHAB grammar), verify
   `CARGO_HOME=.scratch/cargo cargo build --target wasm32-wasip2 --offline`
   is still clean, then **visual check in Zed** (dev-extension flow).
7. Commit (5)+(6) atomically as "Phase B switch".

### Fallback

Phase A stays shippable on its own. The switch is two lines (`extension.toml`
grammar key + `config.toml` `grammar`), so Phase B can land in one commit once
(5)–(6) are done — or be dropped without affecting the released extension.
