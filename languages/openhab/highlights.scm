; openHAB highlighting
;
; Grammar: tree-sitter-openhab (grammar/ — a fork of tree-sitter-java with
; openHAB DSL productions). Every DSL construct has its own named node
; (rule_declaration, item_definition, sitemap_widget, …), so no keyword
; matching by content on identifiers is needed for DSL words.
;
; IMPORTANT: Zed does NOT load a grammar repository's queries/ directory for
; extension grammars — only this languages/openhab/*.scm set is used. So the
; upstream tree-sitter-java highlights (strings, comments, numbers, Java
; keywords, variables, …) are NOT automatically applied; the subset that
; matters for openHAB files is reproduced below, adapted from tree-sitter-java
; queries/highlights.scm. See plan.md (investigation log, 2026-11-19 entries).
;
; Capture names below are restricted to the set Zed themes support, ordered as
; "preferred @ fallback" where a more specific capture may be missing from some
; themes.
;
; Everything here was verified with `tests/harness` (openHAB grammar build)
; against `tests/fixtures/` — see tests/README.md.

; ---------------------------------------------------------------------------
; Variables
; ---------------------------------------------------------------------------

(identifier) @variable

; ---------------------------------------------------------------------------
; Methods / functions
; ---------------------------------------------------------------------------

(method_declaration
  name: (identifier) @function.method @function)
(method_invocation
  name: (identifier) @function.method @function)
(super) @function.builtin @keyword

; openHAB semicolon-less statements in rule bodies: `logInfo(…)`,
; `A.sendCommand(ON)`, `Thread::sleep(200)`.
(oh_call_statement
  name: (identifier) @function.method @function)
(oh_field_call_statement
  name: (identifier) @function.method @function)
(oh_lambda_call
  name: (identifier) @function.method @function)
(oh_method_call_statement
  name: (identifier) @function.method @function)

; ---------------------------------------------------------------------------
; Annotations
; ---------------------------------------------------------------------------

(annotation
  name: (identifier) @attribute)
(marker_annotation
  name: (identifier) @attribute)

"@" @operator

; ---------------------------------------------------------------------------
; Types
; ---------------------------------------------------------------------------

(type_identifier) @type
(scoped_type_identifier) @type

(interface_declaration
  name: (identifier) @type)
(class_declaration
  name: (identifier) @type)
(enum_declaration
  name: (identifier) @type)

((field_access
  object: (identifier) @type)
 (#match? @type "^[A-Z]"))
((scoped_identifier
  scope: (identifier) @type)
 (#match? @type "^[A-Z]"))
((method_invocation
  object: (identifier) @type)
 (#match? @type "^[A-Z]"))
((method_reference
  . (identifier) @type)
 (#match? @type "^[A-Z]"))

(constructor_declaration
  name: (identifier) @type)

[
  (boolean_type)
  (integral_type)
  (floating_point_type)
  (void_type)
] @type.builtin

; ---------------------------------------------------------------------------
; Constants / builtins
; ---------------------------------------------------------------------------

((identifier) @constant
 (#match? @constant "^[_]*[A-Z][A-Z\\d_]+$"))

(this) @variable.builtin @variable

; `ON` / `OFF` / `NULL` / `UNDEF` in trigger states and commands are plain
; identifiers in the grammar; match them by content so they read as builtins,
; not variables.
((identifier) @constant.builtin @constant
 (#match? @constant "^(ON|OFF|NULL|UNDEF)$"))

; ---------------------------------------------------------------------------
; Literals: strings, comments, numbers, booleans
; ---------------------------------------------------------------------------
;
; openHAB accepts single-quoted strings in rule bodies and sitemaps; in
; expression position the lexer may still produce a Java `character_literal`
; (e.g. `'on'` in `if (x.state == 'on')`), so both are captured as @string.

[
  (string_literal)
  (single_quoted_string)
  (character_literal)
] @string
(escape_sequence) @string.escape
(string_interpolation) @string.special

[
  (hex_integer_literal)
  (decimal_integer_literal)
  (octal_integer_literal)
  (binary_integer_literal)
  (decimal_floating_point_literal)
  (hex_floating_point_literal)
] @number

[
  (true)
  (false)
  (null_literal)
] @constant.builtin

[
  (line_comment)
  (block_comment)
] @comment

; ---------------------------------------------------------------------------
; Keywords (Java + openHAB DSL)
; ---------------------------------------------------------------------------

[
  "abstract"
  "assert"
  "break"
  "case"
  "catch"
  "class"
  "continue"
  "default"
  "do"
  "else"
  "enum"
  "exports"
  "extends"
  "final"
  "finally"
  "for"
  "if"
  "implements"
  "import"
  "instanceof"
  "interface"
  "module"
  "native"
  "new"
  "non-sealed"
  "open"
  "opens"
  "package"
  "permits"
  "private"
  "protected"
  "provides"
  "public"
  "requires"
  "record"
  "return"
  "sealed"
  "static"
  "strictfp"
  "switch"
  "synchronized"
  "throw"
  "throws"
  "to"
  "transient"
  "transitive"
  "try"
  "uses"
  "volatile"
  "while"
  "with"
  "yield"
] @keyword

; openHAB DSL keywords — now real grammar tokens, no content matching needed

(rule_declaration "rule" @keyword)
(rule_declaration "script" @keyword)
(rule_declaration "when" @keyword)
(rule_declaration "then" @keyword)
(rule_declaration "end" @keyword)

; Rule triggers: `Item … changed`, `Member of(…) …`, `System started`,
; `Time cron "…"`, `Channel "…" triggered`.
(trigger_condition "Item" @keyword)
(trigger_condition "Member" @keyword)
(trigger_condition "of" @keyword)
(trigger_condition "Thing" @keyword)
(trigger_condition "System" @keyword)
(trigger_condition "Time" @keyword)
(trigger_condition "Channel" @keyword)
(trigger_condition "changed" @keyword)
(trigger_condition "received" @keyword)
(trigger_condition "updated" @keyword)
(trigger_condition "command" @keyword)
(trigger_condition "update" @keyword)
(trigger_condition "from" @keyword)
(trigger_condition "to" @keyword)
(trigger_condition "triggered" @keyword)
(trigger_condition "cron" @keyword)
(trigger_condition "is" @keyword)
(trigger_condition "started" @keyword)
(trigger_condition "shuts" @keyword)
(trigger_condition "shutdown" @keyword)
; `or` / `and` join trigger conditions; they are anonymous children of the
; inlined trigger list, so they cannot be captured under trigger_condition.
"or" @keyword
"and" @keyword
(trigger_condition "START" @constant.builtin)
(trigger_condition "STOP" @constant.builtin)
(trigger_condition "EVENT" @constant.builtin)

; `val` / `var` declarations in rule bodies.
(oh_var_declaration keyword: "val" @keyword.storage @keyword)
(oh_var_declaration keyword: "var" @keyword.storage @keyword)
(oh_var_type) @type.builtin @type

; `(x as DecimalType)` cast.
(oh_as_cast "as" @keyword)

; ---------------------------------------------------------------------------
; Imports
; ---------------------------------------------------------------------------
;
; `import org.eclipse.smarthome.model.script.ScriptServiceUtil` nests
; scoped_identifier nodes. Upstream only types an uppercase-leading *scope*
; segment, so the imported type itself is left as a variable. openHAB users
; scan imports by the last segment, so make that one a type.

(import_declaration
  (scoped_identifier
    name: (identifier) @type))
(import_declaration
  (identifier) @type)

; ---------------------------------------------------------------------------
; .items
; ---------------------------------------------------------------------------

(item_definition
  type: (item_type
    base: (item_type_base) @type.builtin @type))
(item_type sub: (identifier) @type)
(item_type sub: (aggregation_word) @type.builtin @type)
(aggregation_function name: (aggregation_word) @function.builtin @keyword)

(item_definition name: (identifier) @variable)
(item_definition label: (_) @string)
(item_icon name: (identifier) @string.special @string)
(group_list (identifier) @variable)
(tag_list (string_literal) @string)
(tag_list (single_quoted_string) @string)

; Metadata block `{ channel="…", stateDescription { … } }`.
(metadata_entry key: (metadata_key) @property)
(metadata_namespaced_key name: (identifier) @property)
(metadata_entry value: (metadata_value) @string)

; ---------------------------------------------------------------------------
; .things
; ---------------------------------------------------------------------------

(thing_definition kind: "Thing" @keyword)
(thing_definition kind: "Bridge" @keyword)
(thing_uid binding: (identifier) @type)
(thing_uid_segment) @variable
(thing_definition label: (_) @string)
(thing_config_pair key: (identifier) @property)
(thing_config_pair value: (metadata_value) @string)
(channel_section "Channels" @keyword)
(channel_definition "Type" @keyword)
(channel_type) @type.builtin @type
(channel_definition unit: (identifier) @type)
(channel_definition id: (identifier) @variable)
(channel_definition label: (_) @string)

; ---------------------------------------------------------------------------
; .sitemap
; ---------------------------------------------------------------------------

(sitemap_definition "sitemap" @keyword)
(sitemap_definition name: (identifier) @variable)
(sitemap_frame frame_kind: (sitemap_widget_type) @type.builtin @type)
(sitemap_widget widget: (sitemap_widget_type) @type.builtin @type)
(sitemap_widget item: (qualified_name) @variable)
(sitemap_attribute key: "label" @property)
(sitemap_attribute key: "icon" @property)
(sitemap_attribute key: (identifier) @property)
(sitemap_attribute value: (string_literal) @string)
(sitemap_attribute value: (single_quoted_string) @string)
(sitemap_mapping label: (_) @string)

; ---------------------------------------------------------------------------
; .persist
; ---------------------------------------------------------------------------

(persist_strategies_section "Strategies" @keyword)
(persist_items_section "Items" @keyword)
(persist_strategy name: (identifier) @variable)
(persist_strategy "default" @keyword)
(persist_strategy (string_literal) @string)
(persist_item_pattern name: (identifier) @variable)
(persist_strategy_name (identifier) @variable)
(persist_strategy_name "restoreOnStartup" @constant.builtin)
(persist_config "strategy" @property)

; ---------------------------------------------------------------------------
; Punctuation and operators
; ---------------------------------------------------------------------------
;
; Only the delimiters openHAB files use heavily are added; brackets and `.`
; come from the grammar itself.

["," ";"] @punctuation.delimiter

; `->` in map entries and `::` in method references.
("->") @operator
("::") @operator
