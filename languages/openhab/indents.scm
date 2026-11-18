; Auto-indentation for openHAB (Java grammar).
;
; `block` is not limited to `{}` bodies: the Java grammar also builds a block
; for `rule "x" then … end` and similar DSL constructs, which is what gives
; indentation inside openHAB blocks even though the delimiters are not Java's.
;
; No `decrease_indent_pattern` for `end`: `end` is never a real token (it is
; swallowed by ERROR nodes), so a line pattern would either never fire or fire
; on unrelated identifiers such as `endpoint`. See plan.md §9.

(block) @indent
(class_body) @indent
(switch_block) @indent

; Named marker for config.toml's decrease_indent_patterns: `else` aligns with
; the `if` it belongs to. Named @start captures do not open an indent range.
(if_statement) @start.if

(block "}" @end)
(class_body "}" @end)
(switch_block "}" @end)
