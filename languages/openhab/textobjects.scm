; Text objects ("select around / inside") for openHAB.
;
; Java declarations are already covered by the upstream grammar (method and
; class text objects), so this file only adds openHAB-shaped regions and the
; comment objects that the upstream grammar does not provide.
;
; `block` is the only reliably-available "body" node in openHAB files: the Java
; grammar reuses it for `rule … then … end` bodies as well as for `{}` bodies.

(block) @function.around

([
  (line_comment)
  (block_comment)
]+ @comment.around)

(line_comment)+ @comment.inside
