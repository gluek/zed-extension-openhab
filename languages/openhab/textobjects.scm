; Text objects ("select around / inside") for openHAB.

(method_declaration) @function.around
(method_declaration
  body: (block) @function.inside)

(class_declaration) @class.around
(class_declaration
  body: (class_body) @class.inside)

; Adjacent comments, including the Javadoc-style block comments openHAB uses
; above rules and items.
([
  (line_comment)
  (block_comment)
]+ @comment.around)

(line_comment)+ @comment.inside
