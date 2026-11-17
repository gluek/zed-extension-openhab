; openHAB highlighting
;
; Grammar: tree-sitter-java (Phase A). Every node type in this file is a Java
; grammar node; openHAB vocabulary is matched by content on those nodes.
;
; Capture names below are restricted to the set Zed themes support, ordered
; as "preferred @ fallback" where a more specific capture may be missing from
; some themes: (type_identifier) @type @variable.

; ---------------------------------------------------------------------------
; Variables and identifiers
; ---------------------------------------------------------------------------

(identifier) @variable

; ---------------------------------------------------------------------------
; Functions / methods
; ---------------------------------------------------------------------------

(method_declaration
  name: (identifier) @function.method @function)
(method_invocation
  name: (identifier) @function.method @function)
(constructor_declaration
  name: (identifier) @function.method @function)
(super) @function.builtin @keyword

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
] @type.builtin @type

; ---------------------------------------------------------------------------
; openHAB type vocabulary
; ---------------------------------------------------------------------------

; Item types (`.items`), thing types (`.things`); they appear as bare
; identifiers, so match them by name.
((type_identifier) @type.builtin @type
 (#match? @type.builtin "^(Color|Contact|DateTime|Dimmer|Group|Location|Number|Player|Rollershutter|String|Switch|Image|Call|StringList|QuantityType|DecimalType)$"))

; Sitemap widget elements.
((type_identifier) @type.builtin @type
 (#match? @type.builtin "^(Frame|Default|Text|Selection|Setpoint|Slider|Colorpicker|Chart|Webview|Video|Mapview)$"))

; Units of measurement, e.g. `Number:Temperature`, `°C`, `kWh`.
((type_identifier) @type
 (#match? @type "[°]|^(kWh|kW|W|Wh|V|mV|A|mA|%|Hz|kHz|MHz|l|ml|m|cm|mm|km|m2|m3|s|min|h|d|L|kg|g|Pa|hPa|mbar|bar|lux|dB|K)$"))

; ---------------------------------------------------------------------------
; Constants
; ---------------------------------------------------------------------------

((identifier) @constant
 (#match? @constant "^_*[A-Z][A-Z\\d_]+$"))

; Builtins

(this) @variable.builtin @variable

; ---------------------------------------------------------------------------
; Literals
; ---------------------------------------------------------------------------

[
  (hex_integer_literal)
  (decimal_integer_literal)
  (octal_integer_literal)
  (decimal_floating_point_literal)
  (hex_floating_point_literal)
] @number

[
  (character_literal)
  (string_literal)
] @string
(escape_sequence) @string.escape

[
  (true)
  (false)
  (null_literal)
] @constant.builtin @constant

[
  (line_comment)
  (block_comment)
] @comment

; ---------------------------------------------------------------------------
; Keywords — real Java keywords only (these are genuine string nodes)
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
  "extends"
  "final"
  "finally"
  "for"
  "if"
  "implements"
  "import"
  "instanceof"
  "interface"
  "native"
  "new"
  "package"
  "private"
  "protected"
  "public"
  "return"
  "static"
  "switch"
  "synchronized"
  "throw"
  "throws"
  "try"
  "volatile"
  "while"
  "yield"
] @keyword

; ---------------------------------------------------------------------------
; openHAB DSL vocabulary — matched by content on identifiers.
; NOTE: a predicate must reference the capture it is attached to; naming a
; different capture silently disables the filter and matches every node.
; ---------------------------------------------------------------------------

; Control-flow words of rules / sitemaps / persistence.
((identifier) @keyword
 (#match? @keyword "^(rule|when|then|end|sitemap|frame|channel|item|thing|bridge|every|via|strategies|items)$"))

; The same words parse as `type_identifier` when the Java grammar puts them in
; type position. This happens for `when` in a real rule:
;   `Item Motion changed` / `when`  ->  local_variable_declaration whose
;   type is the `when` token, because Java sees `changed when` as a type
;   followed by a missing declarator. Without this rule `when` never
;   highlights, while `rule`/`then`/`end` do.
((type_identifier) @keyword
 (#match? @keyword "^(rule|when|then|end|sitemap|frame|channel|item|thing|bridge|every|via|strategies|items)$"))

; Storage modifiers: openHAB's `val`/`var`, plus rule-level `def`/`override`.
; In a declaration (`val String x = ...`) these parse as `type_identifier`.
((type_identifier) @keyword.storage @keyword
 (#match? @keyword.storage "^(val|var|def|override|threadsafe)$"))
((identifier) @keyword.storage @keyword
 (#match? @keyword.storage "^(val|var|def|override|threadsafe)$"))

; ---------------------------------------------------------------------------
; Punctuation and operators
; ---------------------------------------------------------------------------

["," ";" "."] @punctuation.delimiter @punctuation
["(" ")" "{" "}" "[" "]"] @punctuation.bracket @punctuation

[
  "=="
  "!="
  "<"
  ">"
  "<="
  ">="
  "="
  "+"
  "-"
  "*"
  "/"
  "%"
  "&&"
  "||"
  "!"
  "&"
  "|"
  "^"
  "~"
  "<<"
  ">>"
  ">>>"
  "?"
  ":"
  "->"
  "::"
] @operator
