; Text objects ("select around / inside") for openHAB.
;
; Java declarations are already covered by the upstream grammar (method and
; class text objects), so this file only adds openHAB-shaped regions and the
; comment objects that the upstream grammar does not provide.
;
; `block` plus the DSL bodies (rule_body, sitemap_body, thing_body,
; bridge_body) are the "function"-shaped regions: selecting around a rule or a
; sitemap frame selects its whole body.

(block) @function.around
(rule_body) @function.around
(sitemap_body) @function.around
(thing_body) @function.around
(bridge_body) @function.around

(rule_declaration) @function.around
(item_definition) @class.around
(thing_definition) @class.around
(sitemap_definition) @class.around

([
  (line_comment)
  (block_comment)
]+ @comment.around)

(line_comment)+ @comment.inside
