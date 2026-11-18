; openHAB highlighting
;
; Grammar: tree-sitter-openhab (Phase B, grammar/ — a fork of tree-sitter-java
; with openHAB DSL productions). Every DSL construct has its own named node
; (rule_declaration, item_definition, sitemap_widget, …), so unlike Phase A no
; keyword matching by content on identifiers is needed.
;
; Zed compiles this file on top of tree-sitter-java's own queries/highlights.scm
; (the fork keeps the upstream rules, which already handle variables, methods,
; annotations, types, literals, comments, and the real Java keywords). This file
; therefore only adds what the Java upstream queries get wrong or miss for
; openHAB files. Duplicating the upstream rules would create two rules per node
; and make themes pick unpredictably.
;
; Capture names below are restricted to the set Zed themes support, ordered as
; "preferred @ fallback" where a more specific capture may be missing from some
; themes.
;
; Everything here was verified with `tests/harness` (openHAB grammar build)
; against `tests/fixtures/` — see tests/README.md.

; ---------------------------------------------------------------------------
; Functions / methods
; ---------------------------------------------------------------------------
;
; Add `@function` as a fallback for themes that do not style @function.method.
; The upstream query already captures the same nodes as @function.method.

(method_declaration
  name: (identifier) @function.method @function)
(method_invocation
  name: (identifier) @function.method @function)

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
(super) @function.builtin @keyword

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
; openHAB DSL keywords — now real grammar tokens, no content matching needed
; ---------------------------------------------------------------------------

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
; Constants
; ---------------------------------------------------------------------------

; Builtins

(this) @variable.builtin @variable
(null_literal) @constant.builtin
(true) @constant.builtin
(false) @constant.builtin

; `ON` / `OFF` in trigger states and commands are plain identifiers in the
; grammar; match them by content so they read as builtins, not variables.
((identifier) @constant.builtin @constant
 (#match? @constant "^(ON|OFF|NULL|UNDEF)$"))

; ---------------------------------------------------------------------------
; Punctuation and operators
; ---------------------------------------------------------------------------
;
; Upstream already captures `@` and Java keywords. Only the delimiters openHAB
; files use heavily are added; brackets and `.` come from the grammar itself.

["," ";"] @punctuation.delimiter

; `->` in map entries and `::` in method references.
("->") @operator
("::") @operator
