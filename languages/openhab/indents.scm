; Auto-indentation for openHAB (tree-sitter-openhab grammar).
;
; Indent ranges come from the block-like nodes: Java `block` / `class_body` /
; `switch_block` plus the openHAB DSL bodies (rule_body, sitemap_body,
; bridge_body, thing_body, item_metadata, metadata_block). `rule … then … end`
; has no braces, so rule_body is what gives indentation between `then` and
; `end`.
;
; `decrease_indent_patterns` for `else` lives in config.toml and relies on the
; `@start.if` marker below. No `end` pattern: `end` is a real token now, but a
; line-based pattern would also match `end`-prefixed identifiers in `.rules`
; code, so `rule_body`'s @indent range handles the outdent instead.

(block) @indent
(class_body) @indent
(switch_block) @indent
(rule_body) @indent
(sitemap_body) @indent
(bridge_body) @indent
(thing_body) @indent
(item_metadata) @indent
(metadata_block) @indent

; Named marker for config.toml's decrease_indent_patterns: `else` aligns with
; the `if` it belongs to. Named @start captures do not open an indent range.
(if_statement) @start.if

(block "}" @end)
(class_body "}" @end)
(switch_block "}" @end)
(sitemap_body "}" @end)
(bridge_body "}" @end)
(thing_body "}" @end)
(item_metadata "}" @end)
(metadata_block "}" @end)
