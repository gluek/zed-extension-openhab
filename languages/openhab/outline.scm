; Code outline / structure panel for openHAB.
;
; Two sources of outline items:
;   1. openHAB DSL headers, which the Java grammar does not model.
;   2. Java-level declarations that tree-sitter-java's queries/tags.scm does not
;      cover. That file (applied alongside this one) already outlines classes,
;      interfaces, and methods, so those are deliberately NOT repeated here.
;
; Shapes below were verified with tests/harness (see tests/README.md).

; ---------------------------------------------------------------------------
; Java-level declarations missing from tags.scm
; ---------------------------------------------------------------------------

(enum_declaration
  name: (identifier) @name) @item

(constructor_declaration
  name: (identifier) @name) @item

(record_declaration
  name: (identifier) @name) @item

; ---------------------------------------------------------------------------
; openHAB DSL headers
; ---------------------------------------------------------------------------

; `rule "Name"` / `script "Name"`.
;
; The name string is a separate sibling of the header word, and in this
; tree-sitter version an anchor cannot sit between two sibling patterns, so the
; header statement is matched whole and only its first identifier is filtered.
; @item is the keyword word rather than the statement, so the outline entry does
; not span the entire statement.
;
; Whether this can fire at all depends on error recovery: a top-level bare
; identifier is not valid Java (program accepts only method_declaration and
; statement), so `rule` is only an expression_statement when the header happens
; to be absorbed into a statement context. That is the case for a file with an
; `import` and an `Item … changed` trigger, but not in general. When it fails,
; the header sits inside an ERROR node and nothing can be captured — the outline
; is simply empty for that region. Fixed by Phase B.
((expression_statement
  (identifier) @name) @item
 (#match? @name "^(rule|script)$"))

; `sitemap name label="…"` and `Frame label="…"`.
;
; Both parse as local_variable_declaration with a type_identifier naming the
; construct and a label string. The label is the useful outline text.
;
; `@context` carries the construct so that nested frames read as
; "sitemap > Frame"; see zed_extension.md §Code outline.
((local_variable_declaration
  type: (type_identifier) @context
  declarator: (variable_declarator
    (identifier) @_key
    value: (string_literal) @name)) @item
 (#match? @context "^(sitemap|Frame)$")
 (#eq? @_key "label"))

; ---------------------------------------------------------------------------
; `.items` group definitions
; ---------------------------------------------------------------------------
;
; Only groups are outlined. Outlining every item would bury groups in large
; files, and items are easy to reach by fuzzy search.
;
; Two shapes: `Group gLights "…"` is a local_variable_declaration whose type is
; the item type, while `Group:Number:AVG gTemperature "…"` is a labeled_statement.
;
; The `value:` / `;` constraints keep sitemap widgets out: `Group item=gLights`
; in a `.sitemap` has the same outer shape but assigns `item` instead of
; declaring a literal.

((local_variable_declaration
  type: (type_identifier) @_type
  declarator: (variable_declarator
    name: (identifier) @name)) @item
 (#eq? @_type "Group")
 (#not-eq? @name "item"))

((labeled_statement
  (identifier) @_type
  ":"
  (local_variable_declaration
    declarator: (variable_declarator
      name: (identifier) @name))) @item
 (#eq? @_type "Group"))
