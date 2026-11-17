; Code outline / structure panel for openHAB.
;
; Rule-level constructs (Java) plus DSL-level blocks matched by content.

(class_declaration
  name: (identifier) @name) @item

(interface_declaration
  name: (identifier) @name) @item

(enum_declaration
  name: (identifier) @name) @item

(method_declaration
  name: (identifier) @name) @item

(constructor_declaration
  name: (identifier) @name) @item

(import_declaration) @item

; openHAB block headers: `rule "..."`, `sitemap name label="..."`.
; These words are not Java keywords, so they parse as plain identifiers.
((identifier) @name
  (#match? @name "^(rule|sitemap)$")) @item
