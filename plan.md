# Plan: Zed language extension for openHAB

Port the openHAB Visual Studio Code extension into a **Zed language extension** that provides:

1. **Syntax highlighting** (and the closely-coupled editor features: bracket matching, auto-indent, outline)
2. **Auto-complete** (items from a running openHAB instance).

The working directory for the new extension is [`zed/openhab-zed/`](zed/openhab-zed/) — scaffolded, installed as a **dev extension** and highlighting works in Zed. The existing VS Code extension is left untouched; we only *read* from it.

**Status:** Phase A (scaffold + syntax highlighting) is **done and verified in Zed**. Auto-complete is **not implemented yet** — the language server is registered but no server bundle ships, so it does not start (see §7).

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

**Phase B — replace with a purpose-built `tree-sitter-openhab` grammar.** *(not started; milestone 4)*
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
   - **Implemented so far:** `src/openhab.rs` resolves `zed::node_binary_path()` + the server script (checking `server/LSPServer.js`, then `../serverJS/out/LSPServer.js`), passes `--stdio`, and supplies `initialization_options` / `workspace/configuration` with defaults (`host`, `port`, `authToken`, `itemCasing`, `lspEnabled`). It returns a clear error when the bundle is absent — which is the current state.
6. **Robustness:** if the server bundle is missing or openHAB is unreachable, `language_server_command` / the server must fail gracefully (log, no crash) — Zed surfaces the error in its log.

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
| ✅ 1 | **Phase A highlighting** via `tree-sitter-java` | `highlights.scm`, `brackets.scm`, `indents.scm`, `outline.scm`, `textobjects.scm` | `tree-sitter query` compiles; captures verified on fixtures; **confirmed visually in Zed ("okayish")** |
| 2 | **LSP packaging** | ⚠️ *Rust wiring done, bundle missing* — needs `server/LSPServer.js`; stdio; `initializationOptions` | Completion works against a real openHAB |
| 3 | **LSP completion polish** | context-aware completion, details/docs, casing | Manual + unit tests (`serverJS/__tests__`) |
| 4 | **Phase B grammar** | `tree-sitter-openhab` with DSL productions; swap grammar key + `config.toml` | `tree-sitter parse` clean on fixtures; visual parity vs Phase A |
| 5 | Docs + release | `zed/README.md`, CI to build Rust target matrix, grammar rev pin | CI green |

### Current known limitations (Phase A)

- **`.rules` highlighting is partial.** The best candidates for Phase B:
  - `when` is **not** highlighted in a bare `rule "name"` header. In type position
    it parses as a `type_identifier` (fixed — see notes), but when the `rule` header
    is unrecoverable the whole region becomes an `ERROR` node and `when` is
    anonymous text inside it, so no query can reach it. Wrapping the rule body in
    `rule "name" { … }` makes `when` highlight.
  - Rule bodies produce many `ERROR` nodes (see notes below). Brackets/indent still work.
- `.items` / `.things` / `.sitemap` / `.persist` are line-oriented and highlight acceptably.
- **The language server errors on startup** (logged once, harmless) because no server bundle ships yet — this is milestone 2, not a regression.

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
