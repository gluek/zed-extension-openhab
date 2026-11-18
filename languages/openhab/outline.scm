; Code outline / structure panel for openHAB (tree-sitter-openhab grammar).
;
; Two sources of outline items:
;   1. openHAB DSL constructs, which now have their own named nodes
;      (rule_declaration, item_definition, thing_definition, sitemap_*, persist_*).
;   2. Java-level declarations that tree-sitter-java's queries/tags.scm does not
;      cover. That file (applied alongside this one) already outlines classes,
;      interfaces, and methods, so those are deliberately NOT repeated here.
;
; Shapes below were verified with `tests/harness` (openHAB grammar build)
; against `tests/fixtures/` — see tests/README.md.

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
; .rules / .script — `rule "Name" when … then … end`
; ---------------------------------------------------------------------------

(rule_declaration
  name: (_) @name) @item

; ---------------------------------------------------------------------------
; .items — item definitions
; ---------------------------------------------------------------------------
;
; Outlining every item would bury groups in large files, and items are easy to
; reach by fuzzy search, so only groups are outlined. The label is shown as
; @context so entries read as "gLights — All Lights".

((item_definition
  type: (item_type base: (item_type_base) @_type)
  name: (identifier) @name
  label: (_) @context) @item
 (#eq? @_type "Group"))

; ---------------------------------------------------------------------------
; .things — Thing / Bridge definitions
; ---------------------------------------------------------------------------

(thing_definition
  uid: (thing_uid) @name
  label: (_) @context) @item

(channel_definition
  id: (identifier) @name
  label: (_) @context) @item

; ---------------------------------------------------------------------------
; .sitemap — sitemap, frames, widgets
; ---------------------------------------------------------------------------
;
; Widgets are outlined by their label attribute when present, otherwise by the
; bound item. Frames by label. The sitemap itself by its name.

(sitemap_definition
  name: (identifier) @name) @item

; Frames (Frame/Text with a body) outline by their label, with the frame kind
; as context. Since Phase B, a `Frame label="x" { … }` line parses as
; sitemap_widget (frame_word is accepted there), so this rule covers that
; shape; sitemap_frame covers the same tokens when the parser picks the frame
; production.
((sitemap_widget
  widget: (sitemap_widget_type) @context
  attribute: (sitemap_attribute
    key: "label"
    value: (_) @name)) @item
 (#match? @context "^(Frame|Text)$"))

((sitemap_frame
  frame_kind: (sitemap_widget_type) @context
  attribute: (sitemap_attribute
    key: "label"
    value: (_) @name)) @item
 (#match? @context "^(Frame|Text)$"))

; Widget with a label attribute: outline by that label, with the widget type
; as context ("Switch — Hue Lampen Szenen"). Frame/Text shapes are excluded
; here because they are outlined by the frame rule above.
((sitemap_widget
  widget: (sitemap_widget_type) @context
  attribute: (sitemap_attribute
    key: "label"
    value: (_) @name)) @item
 (#not-match? @context "^(Frame|Text)$"))

; Widget without a label: outline by the bound item instead. Frame/Text shapes
; are excluded so they are only outlined by their label rule above. Anchored
; with `#not-match?` on @context and made mutually exclusive with the label
; rule by requiring no label attribute to be present is not expressible, so
; both rules may fire on one widget — Zed merges duplicate @item captures on the
; same node into a single outline entry.
((sitemap_widget
  widget: (sitemap_widget_type) @context
  item: (qualified_name) @name) @item
 (#not-match? @context "^(Frame|Text)$"))

; ---------------------------------------------------------------------------
; .persist — strategy and item-pattern sections
; ---------------------------------------------------------------------------

(persist_strategies_section
  (persist_strategy name: (identifier) @name)) @item

(persist_items_section
  (persist_config items: (persist_item_pattern) @name)) @item
