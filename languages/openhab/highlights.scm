; openHAB highlighting
;
; Grammar: tree-sitter-java (Phase A). Every node type in this file is a Java
; grammar node; openHAB vocabulary is matched by content on those nodes.
;
; Zed compiles this file on top of tree-sitter-java's own queries/highlights.scm,
; which already handles variables, methods, annotations, types, literals,
; comments, and the real Java keywords. This file therefore only adds what the
; Java upstream queries get wrong or miss for openHAB files. Duplicating the
; upstream rules would create two rules per node and make themes pick
; unpredictably.
;
; Capture names below are restricted to the set Zed themes support, ordered
; as "preferred @ fallback" where a more specific capture may be missing from
; some themes: (type_identifier) @type @variable.
;
; Everything here was verified with `tests/harness` against `tests/fixtures/`
; (see tests/README.md). Where a construct cannot be captured at all because
; the Java grammar buries it inside an ERROR node, a comment says so instead of
; a query that silently never fires.

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
(super) @function.builtin @keyword

; ---------------------------------------------------------------------------
; Imports
; ---------------------------------------------------------------------------
;
; `import org.eclipse.smarthome.model.script.ScriptServiceUtil` nests
; scoped_identifier nodes. Upstream only types an uppercase-leading *scope*
; segment, so the imported type itself is left as a variable. openHAB users
; scan imports by the last segment, so make that one a type.
;
; Only imports terminated by `;` (or the last construct in the file) are
; parsed as import_declaration; a semicolon-less import followed by another
; statement becomes one ERROR node spanning the rest of the file and nothing
; inside it can be captured. See plan.md §9.

(import_declaration
  (scoped_identifier
    name: (identifier) @type))
(import_declaration
  (identifier) @type)

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

; `.items` item types are already `type_identifier`s in most positions and are
; styled by the vocabulary rules above. Two shapes escape those rules because
; Java makes them plain identifiers:
;
;   Group:Number:AVG gTemperature …   -> labeled_statement > identifier
;   Group:Number:SUM gEnergy …       -> labeled_statement > labeled_statement
;
; Only the leading segment of a nested label chain reaches the labeled_statement
; itself, hence the extra rule below.
((labeled_statement
  (identifier) @type.builtin @type)
 (#match? @type.builtin "^(Group|Number|String|Switch|Dimmer|Color|DateTime|Contact|Player|Image|Location|Rollershutter|Call)$"))

; `Number:Temperature`, `Number:Power` (no third segment, no trailing value
; type) never become a labeled_statement; they collapse into an ERROR node's
; sibling identifiers and cannot be captured reliably in Phase A.

; ---------------------------------------------------------------------------
; Constants
; ---------------------------------------------------------------------------

; Builtins

(this) @variable.builtin @variable

; ---------------------------------------------------------------------------
; openHAB DSL vocabulary — matched by content on identifiers.
; ---------------------------------------------------------------------------
;
; NOTE: a predicate must reference the capture it is attached to; naming a
; different capture silently disables the filter. Also note that predicates
; attached to an alternation `[(a) (b)]` are ignored by tree-sitter here, which
; is why the two node types below are written as separate patterns.
;
; The same word can appear as either node type depending on position: `when`
; parses as a `type_identifier` in a rule body, `val`/`var` as `type_identifier`
; when they start a declaration, but as `identifier` elsewhere (`end` in
; `sample.rules` is a `type_identifier` in three of four rules). Both node
; types are therefore matched.
;
; Known limitation: these rules match the word anywhere it survives as a named
; node, so an item literally named e.g. `Channel` highlights as a keyword. The
; parsing is too broken to express "keyword position" reliably, and Phase B
; (a purpose-built grammar) is the fix.

((identifier) @keyword
 (#match? @keyword "^(rule|when|then|end|sitemap|frame|channel|item|thing|bridge|every|via|strategies|items)$"))
((type_identifier) @keyword
 (#match? @keyword "^(rule|when|then|end|sitemap|frame|channel|item|thing|bridge|every|via|strategies|items)$"))

; Storage modifiers: openHAB's `val`/`var`, plus rule-level `def`/`override`.
((type_identifier) @keyword.storage @keyword
 (#match? @keyword.storage "^(val|var|def|override|threadsafe)$"))
((identifier) @keyword.storage @keyword
 (#match? @keyword.storage "^(val|var|def|override|threadsafe)$"))

; Rule trigger vocabulary (`when Item A changed`, `Channel … triggered`,
; `System started`, `Time cron`). Only capitalized forms are listed so that
; ordinary identifiers such as a method called `started` are not swept in.
((identifier) @keyword
 (#match? @keyword "^(Item|Thing|System|Channel|Time|cron|changed|started|triggered|received|command)$"))

; ---------------------------------------------------------------------------
; Punctuation and operators
; ---------------------------------------------------------------------------
;
; Upstream already captures `@` and Java keywords. Only the delimiters openHAB
; files use heavily are added; brackets and `.` come from the grammar itself.

["," ";"] @punctuation.delimiter
