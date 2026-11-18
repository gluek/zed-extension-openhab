/**
 * @file openHAB grammar for tree-sitter
 * @license MIT (forked from tree-sitter-java, see LICENSE)
 *
 * A fork of tree-sitter-java that adds the openHAB textual configuration
 * dialects:
 *
 *   .rules / .script   Java + `rule "x" when … then … end`
 *   .items             `Type Name "Label" <icon> (groups) ["tags"] { meta }`
 *   .things            `Bridge`/`Thing`/`Channels:` blocks
 *   .sitemap           `sitemap x label="…" { Frame { Widget item=… } }`
 *   .persist           `Strategies { }` / `Items { }`
 *
 * The Java productions are untouched wherever possible; openHAB constructs are
 * added as extra statement alternatives and as separate top-level items, so
 * Java code inside rule bodies keeps parsing exactly as before.
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const DIGITS = token(choice('0', seq(/[1-9]/, optional(seq(optional('_'), sep1(/[0-9]+/, /_+/))))));
const DECIMAL_DIGITS = token(sep1(/[0-9]+/, '_'));
const HEX_DIGITS = token(sep1(/[A-Fa-f0-9]+/, '_'));

/* eslint-disable no-multi-spaces */

const PREC = {
  // https://introcs.cs.princeton.edu/java/11precedence/
  COMMENT: 0,         // //  /*  */
  ASSIGN: 1,          // =  += -=  *=  /=  %=  &=  ^=  |=  <<=  >>=  >>>=
  DECL: 2,
  ELEMENT_VAL: 2,
  TERNARY: 3,         // ?:
  OR: 4,              // ||
  AND: 5,             // &&
  BIT_OR: 6,          // |
  BIT_XOR: 7,         // ^
  BIT_AND: 8,         // &
  EQUALITY: 9,        // ==  !=
  GENERIC: 10,
  REL: 10,            // <  <=  >  >=  instanceof
  SHIFT: 11,          // <<  >>  >>>
  ADD: 12,            // +  -
  MULT: 13,           // *  /  %
  CAST: 14,           // (Type)
  OBJ_INST: 14,       // new
  UNARY: 15,          // ++a  --a  a++  a--  +  -  !  ~
  ARRAY: 16,          // [Index]
  OBJ_ACCESS: 16,     // .
  PARENS: 16,         // (Expression)
  CLASS_LITERAL: 17,  // .
};

/* eslint-enable no-multi-spaces */

module.exports = grammar({
  name: 'openhab',

  extras: $ => [
    $.line_comment,
    $.block_comment,
    /\s/,
  ],

  supertypes: $ => [
    $.expression,
    $.declaration,
    $.statement,
    $.primary_expression,
    $._literal,
    $._type,
    $._simple_type,
    $._unannotated_type,
    $.module_directive,
  ],

  inline: $ => [
    $._name,
    $._simple_type,
    $._class_body_declaration,
    $._variable_initializer,
    // openHAB: inlined so `when`/`then`/`end` are not wrapped in a one-child node.
    $._oh_rule_part,
    // Inlined so a declaration reachable from both `program` and `statement`
    // does not create two competing interpretations of the same tokens.
    $._oh_declaration,
  ],

  conflicts: $ => [
    // openHAB: `.items` item types and `.sitemap` widget types are the same
    // words. A file contains one dialect only, so the parser may defer the
    // decision until it sees what follows.
    // openHAB additions
    // ---------------------------------------------------------------------
    // The `[$.item_definition, $.statement]` and `[$.item_type, $.sitemap_widget]`
    // conflicts are the load-bearing ones. The long tail below exists because
    // `oh_lambda` (`[| … ]`) re-opens expression parsing inside a context where
    // Java's `identifier (` / `type (` ambiguities (method_invocation vs.
    // primary/field_access, instanceof vs. record_pattern, type vs. array_type)
    // would otherwise fork. `tree-sitter generate` reports many of them as
    // "unnecessary" in the abstract, but removing any one reintroduces an
    // "Unresolved conflict" error at that exact state — they are kept on purpose.
    [$.item_definition, $.statement],
    [$.item_type, $.sitemap_widget],
    // openHAB: `Group:Number:AVG …` — the `:` chain after the base type word
    // also starts a Java labeled statement. Defer until the item name arrives.
    [$.item_type, $.labeled_statement],
    [$.item_definition, $.labeled_statement],
    [$.item_type, $.expression_statement],
    [$.item_type, $.local_variable_declaration],
    [$.item_definition, $.item_type],
    [$.item_type, $.item_definition],
    [$.sitemap_widget, $.item_type],
    [$.sitemap_widget, $.item_definition],
    // openHAB: `Group:Number:AVG g …` — after the `:sub` chain the name is a
    // plain identifier, but the same token can start a labeled statement or an
    // expression in the Java interpretations. Defer until the label string.
    [$.item_type, $.identifier],
    [$.aggregation_function, $.identifier],
    [$.item_type, $.sitemap_widget],
    [$.item_definition, $.sitemap_widget],
    [$.item_type, $.statement],
    [$.item_type, $.local_variable_declaration],
    [$.item_type, $.item_definition],
    [$.item_type, $.aggregation_function],
    [$.aggregation_function, $.item_definition],
    [$.item_definition, $.aggregation_function],
    [$.item_type, $.aggregation_function],
    [$.aggregation_function, $.item_type],
    [$.aggregation_function, $.item_definition],
    [$.aggregation_function, $.statement],
    [$.aggregation_function, $.expression_statement],
    [$.aggregation_function, $.labeled_statement],
    [$.item_definition, $.aggregation_function],
    [$.item_type, $.aggregation_function],
    [$.aggregation_function, $.item_type],
    [$.aggregation_function, $.item_definition],
    [$.aggregation_function, $.identifier],
    [$.item_type, $.identifier],
    [$.item_definition, $.aggregation_function],
    [$.item_definition, $._oh_string],
    [$.item_type, $._oh_string],
    [$.aggregation_function, $._oh_string],
    [$.item_definition, $.identifier],
    [$.item_type, $.identifier],
    [$.aggregation_function, $.identifier],
    [$.item_definition, $.sitemap_widget],
    [$.item_type, $.sitemap_widget],
    [$.item_definition, $.statement],
    [$.item_type, $.statement],
    [$.item_definition, $.expression_statement],
    [$.item_type, $.expression_statement],
    [$.item_definition, $.local_variable_declaration],
    [$.item_type, $.local_variable_declaration],
    [$.item_definition, $.labeled_statement],
    [$.item_type, $.labeled_statement],
    [$.sitemap_mappings, $.sitemap_visibility],
    // openHAB: `Text`/`Frame` now appear in both sitemap_frame and
    // sitemap_widget (a bare `Text item=…` line is a widget); after the
    // `{ … }` body the parser must defer which one it is until the next
    // token shows whether the block belongs to a frame or ends the widget.
    [$.sitemap_frame, $.sitemap_widget],
    // openHAB: single-quoted strings are full strings in the rule DSL, not
    // Java character literals.
    [$.single_quoted_string, $.character_literal],
    [$.single_quoted_string, $.expression],
    // openHAB: `f(…)` without a trailing `;` in a rule body is `oh_call_statement`,
    // not a method_invocation expression that would want a `;`
    [$.oh_call_statement, $.expression_statement],
    [$.oh_call_statement, $.method_invocation],
    [$.oh_call_statement, $.primary_expression],
    [$.oh_field_call_statement, $.method_invocation],
    [$.oh_field_call_statement, $.field_access],
    [$.oh_field_call_statement, $.expression_statement],
    [$.oh_field_call_statement, $.primary_expression],
    [$.oh_field_call_statement, $.statement],
    [$.oh_field_call_statement, $.scoped_type_identifier],
    [$.oh_field_call_statement, $._unannotated_type],
    [$.oh_field_call_statement, $.primary_expression],
    [$.statement, $._unannotated_type],
    [$.oh_field_call_statement, $.statement],
    [$.oh_field_call_statement, $.expression],
    [$._unannotated_type, $.primary_expression],
    [$.oh_var_declaration, $.local_variable_declaration],
    [$.oh_var_declaration, $.expression_statement],
    [$.oh_var_declaration, $.statement],
    [$.oh_var_declaration, $.identifier],
    [$.oh_var_declaration, $._type],
    [$.oh_var_declaration, $.array_access],
    [$.oh_var_declaration, $.expression],
    [$.oh_var_declaration, $.primary_expression],
    [$.oh_var_declaration, $.binary_expression],
    [$.oh_var_declaration, $.unary_expression],
    [$.oh_var_declaration, $.cast_expression],
    [$.oh_var_value, $.array_access],
    [$.oh_var_value, $.primary_expression],
    [$.oh_var_value, $.expression],
    [$.oh_var_value, $.cast_expression],
    [$.oh_var_value, $.binary_expression],
    [$.oh_var_value, $.unary_expression],
    [$.oh_var_declaration, $.array_access],
    [$.oh_var_declaration, $.binary_expression],
    [$.oh_var_declaration, $.unary_expression],
    [$.oh_var_declaration, $.cast_expression],
    [$.oh_var_declaration, $.primary_expression],
    [$.oh_var_declaration, $.expression],
    [$.oh_var_value, $.array_access],
    [$.oh_var_value, $.expression],
    [$.expression, $.array_access],
    [$.cast_expression, $.formal_parameters],
    [$.cast_expression, $.inferred_parameters],
    [$.cast_expression, $.parenthesized_expression],
    [$.cast_expression, $.method_invocation],
    [$.cast_expression, $.field_access],
    [$.cast_expression, $.primary_expression],
    [$.cast_expression, $.expression],
    [$.cast_expression, $.binary_expression],
    [$.cast_expression, $.unary_expression],
    [$.cast_expression, $.field_access],
    [$.cast_expression, $.method_invocation],
    [$.oh_as_cast, $.method_invocation],
    [$.oh_as_cast, $.field_access],
    [$.oh_as_cast, $.parenthesized_expression],
    [$.oh_as_cast, $.formal_parameters],
    // openHAB: `["Tag"]` (tags) vs. `[ key=value ]` (Location config) after an
    // item name — both are bracketed lists, defer until the contents show.
    [$.tag_list, $.thing_config],
    [$.tag_list, $.metadata_config],
    // openHAB: a top-level `{ … }` after a Bridge header is a bridge body, not
    // a plain Java block statement.
    [$.bridge_body, $.block],
    [$.bridge_body, $.statement],
    [$.thing_body, $.bridge_body],
    [$.bridge_body, $.thing_body],
    [$.thing_uid, $.statement],
    [$.thing_uid, $.labeled_statement],
    [$.thing_uid, $.expression_statement],
    [$.thing_definition, $.statement],
    [$.thing_definition, $.labeled_statement],
    [$.thing_definition, $.expression_statement],
    [$.thing_definition, $.local_variable_declaration],
    [$.thing_uid, $.qualified_name],
    [$.thing_uid, $._type],
    [$.thing_uid, $.scoped_type_identifier],
    [$.thing_uid, $.identifier],
    [$.modifiers, $.annotated_type, $.receiver_parameter],
    [$.modifiers, $.annotated_type, $.module_declaration, $.package_declaration],
    [$._unannotated_type, $.primary_expression, $.inferred_parameters],
    [$._unannotated_type, $.primary_expression],
    [$._unannotated_type, $.primary_expression, $.scoped_type_identifier],
    [$._unannotated_type, $.scoped_type_identifier],
    [$._unannotated_type, $.generic_type],
    [$.generic_type, $.primary_expression],
    [$.expression, $.statement],
    // Only conflicts in switch expressions
    [$.lambda_expression, $.primary_expression],
    // openHAB: inside `[| … ]`, `identifier (` is a call (method_invocation),
    // not a primary_expression that continues as array access.
    [$.method_invocation, $.primary_expression],
    [$.oh_lambda_statement, $.primary_expression],
    // openHAB: in a lambda body, `x (` is a call, not a field access that a
    // following `(` would extend.
    [$.oh_lambda_statement, $.field_access],
    [$.method_invocation, $.field_access],
    // openHAB: `X::y(…)` in a lambda body is a call, not a bare reference.
    [$.oh_method_call_statement, $.method_reference],
    // openHAB: inside `[| … ]` prefer the lambda's own expression rule over
    // the general `expression` so binary/unary continuations stay in it.
    [$.oh_lambda_expression, $.expression],
    [$.oh_lambda_expression, $.instanceof_expression],
    [$.oh_lambda, $.instanceof_expression],
    [$.oh_lambda_statement, $.instanceof_expression],
    [$.unary_expression, $.instanceof_expression],
    [$.oh_lambda_expression, $.unary_expression],
    [$.binary_expression, $.instanceof_expression],
    [$.oh_lambda_expression, $.binary_expression],
    [$.oh_lambda_statement, $.unary_expression],
    [$.oh_lambda_statement, $.binary_expression],
    [$.oh_lambda, $.unary_expression],
    [$.oh_lambda, $.binary_expression],
    [$.oh_lambda_field_statement, $.scoped_type_identifier],
    [$.oh_lambda_statement, $.scoped_type_identifier],
    [$.oh_lambda, $.scoped_type_identifier],
    [$.oh_lambda_field_statement, $.argument_list],
    [$.oh_lambda_field_statement, $.method_invocation],
    [$.oh_lambda_field_statement, $.expression],
    [$.oh_lambda_field_statement, $.primary_expression],
    [$.oh_lambda_field_statement, $.field_access],
    [$.oh_lambda_statement, $.field_access],
    [$.oh_lambda_call, $.method_invocation],
    [$.oh_lambda_call, $.scoped_type_identifier],
    [$.oh_lambda_call, $.field_access],
    [$.oh_lambda_call, $.primary_expression],
    [$.oh_lambda_statement, $.oh_lambda_call],
    [$.oh_lambda, $.oh_lambda_call],
    [$.oh_lambda_call, $.expression],
    [$.oh_lambda_call, $._type],
    [$.oh_lambda_call, $.generic_type],
    [$.oh_lambda_statement, $.expression],
    [$.oh_lambda, $.expression],
    [$.oh_lambda_field_statement, $.oh_lambda_expression],
    [$.oh_lambda_call, $.oh_lambda_expression],
    [$.oh_lambda_statement, $.primary_expression],
    [$.oh_lambda_statement, $.field_access],
    [$.oh_lambda_statement, $.scoped_type_identifier],
    [$.oh_lambda, $.scoped_type_identifier],
    [$.oh_lambda_field_statement, $.scoped_type_identifier],
    [$.oh_lambda_call, $.scoped_type_identifier],
    [$.oh_lambda_expression, $.instanceof_expression],
    [$.unary_expression, $.instanceof_expression],
    [$.binary_expression, $.instanceof_expression],
    [$.oh_lambda_statement, $.instanceof_expression],
    [$.expression, $.instanceof_expression],
    [$.oh_lambda_statement, $.expression],
    [$.oh_lambda, $.expression],
    [$.oh_lambda_statement, $._reserved_identifier],
    [$.oh_lambda, $._reserved_identifier],
    [$.unary_expression, $._reserved_identifier],
    [$.expression, $._reserved_identifier],
    [$.oh_lambda_statement, $.instanceof_expression],
    [$.instanceof_expression, $.oh_lambda_statement],
    [$.instanceof_expression, $.expression],
    [$.instanceof_expression, $._reserved_identifier],
    [$.oh_lambda, $._type],
    [$.oh_lambda, $.array_type],
    [$.oh_lambda_statement, $._type],
    [$.oh_lambda_statement, $.array_type],
    [$.oh_lambda_expression, $._type],
    [$.oh_lambda_expression, $.array_type],
    [$.unary_expression, $._type],
    [$.unary_expression, $.array_type],
    [$._type, $.array_type],
    [$.oh_lambda, $.annotated_type],
    [$.oh_lambda_statement, $.annotated_type],
    [$.oh_lambda, $.array_type],
    [$.oh_lambda_statement, $.array_type],
    [$.annotated_type, $.array_type],
    [$.oh_lambda, $.modifiers],
    [$.oh_lambda_statement, $.modifiers],
    // openHAB: keep `x instanceof Y` inside a lambda body from forking into a
    // record pattern when a `(` follows the type.
    [$.expression, $.record_pattern],
    [$.instanceof_expression, $.record_pattern],
    [$._unannotated_type, $.record_pattern],
    [$.instanceof_expression, $._reserved_identifier],
    [$.instanceof_expression, $.yield_statement],
    [$.instanceof_expression, $._type],
    [$.instanceof_expression, $.record_pattern_body],
    [$.inferred_parameters, $.primary_expression],
    [$.argument_list, $.record_pattern_body],
    [$.yield_statement, $._reserved_identifier],
  ],

  word: $ => $.identifier,

  rules: {
    program: $ => repeat($._toplevel_statement),

    _toplevel_statement: $ => choice(
      // `statement` already includes openHAB declarations via its own choice,
      // so listing them again here would create two interpretations of the
      // same tokens.
      $.statement,
      $.method_declaration,
    ),

    // Literals

    _literal: $ => choice(
      $.decimal_integer_literal,
      $.hex_integer_literal,
      $.octal_integer_literal,
      $.binary_integer_literal,
      $.decimal_floating_point_literal,
      $.hex_floating_point_literal,
      $.true,
      $.false,
      // openHAB rule DSL uses single quotes for multi-char strings (JSON
      // payloads, comparison values like 'arrow_left_click'); Java would lex
      // those as `character_literal`. Declared ahead of `character_literal`
      // so the longer token wins at the lexer level.
      $.single_quoted_string,
      $.character_literal,
      $.string_literal,
      $.null_literal,
    ),

    decimal_integer_literal: _ => token(seq(
      DIGITS,
      optional(choice('l', 'L')),
    )),

    hex_integer_literal: _ => token(seq(
      choice('0x', '0X'),
      HEX_DIGITS,
      optional(choice('l', 'L')),
    )),

    octal_integer_literal: _ => token(seq(
      choice('0o', '0O', '0'),
      sep1(/[0-7]+/, '_'),
      optional(choice('l', 'L')),
    )),

    binary_integer_literal: _ => token(seq(
      choice('0b', '0B'),
      sep1(/[01]+/, '_'),
      optional(choice('l', 'L')),
    )),

    decimal_floating_point_literal: _ => token(choice(
      seq(DECIMAL_DIGITS, '.', optional(DECIMAL_DIGITS), optional(seq((/[eE]/), optional(choice('-', '+')), DECIMAL_DIGITS)), optional(/[fFdD]/)),
      seq('.', DECIMAL_DIGITS, optional(seq((/[eE]/), optional(choice('-', '+')), DECIMAL_DIGITS)), optional(/[fFdD]/)),
      seq(DIGITS, /[eE]/, optional(choice('-', '+')), DECIMAL_DIGITS, optional(/[fFdD]/)),
      seq(DIGITS, optional(seq((/[eE]/), optional(choice('-', '+')), DECIMAL_DIGITS)), (/[fFdD]/)),
    )),

    hex_floating_point_literal: _ => token(seq(
      choice('0x', '0X'),
      choice(
        seq(HEX_DIGITS, optional('.')),
        seq(optional(HEX_DIGITS), '.', HEX_DIGITS),
      ),
      optional(seq(
        /[pP]/,
        optional(choice('-', '+')),
        DIGITS,
        optional(/[fFdD]/),
      )),
    )),

    true: _ => 'true',

    false: _ => 'false',

    character_literal: _ => token(seq(
      '\'',
      repeat1(choice(
        /[^\\'\n]/,
        /\\./,
        /\\\n/,
      )),
      '\'',
    )),

    string_literal: $ => choice($._string_literal, $._multiline_string_literal),
    _string_literal: $ => seq(
      '"',
      repeat(choice(
        $.string_fragment,
        $.escape_sequence,
        $.string_interpolation,
      )),
      '"',
    ),
    _multiline_string_literal: $ => seq(
      '"""',
      repeat(choice(
        alias($._multiline_string_fragment, $.multiline_string_fragment),
        $._escape_sequence,
        $.string_interpolation,
      )),
      '"""',
    ),
    // Workaround to https://github.com/tree-sitter/tree-sitter/issues/1156
    // We give names to the token() constructs containing a regexp
    // so as to obtain a node in the CST.

    string_fragment: _ => token.immediate(prec(1, /[^"\\]+/)),
    _multiline_string_fragment: _ => choice(
      /[^"\\]+/,
      /"([^"\\]|\\")*/,
    ),

    string_interpolation: $ => seq(
      '\\{',
      $.expression,
      '}',
    ),

    _escape_sequence: $ => choice(
      prec(2, token.immediate(seq('\\', /[^bfnrts'\"\\]/))),
      prec(1, $.escape_sequence),
    ),
    escape_sequence: _ => token.immediate(seq(
      '\\',
      choice(
        /[^xu0-7]/,
        /[0-7]{1,3}/,
        /x[0-9a-fA-F]{2}/,
        /u[0-9a-fA-F]{4}/,
        /u\{[0-9a-fA-F]+\}/,
      ))),

    null_literal: _ => 'null',

    // Expressions

    expression: $ => choice(
      $.assignment_expression,
      $.binary_expression,
      $.instanceof_expression,
      $.lambda_expression,
      $.oh_lambda,
      $.ternary_expression,
      $.update_expression,
      $.primary_expression,
      $.unary_expression,
      $.cast_expression,
      $.switch_expression,
    ),

    // openHAB `as` cast: `(x as DecimalType)`. Kept as a standalone rule (not
    // inlined into `primary_expression`) so the `(value as type)` shape does
    // not fork the parser at the `as` against parenthesized lambdas.
    oh_as_cast: $ => prec.right(PREC.CAST + 1, seq(
      '(',
      field('value', choice($.primary_expression, $.field_access, $.method_invocation)),
      'as',
      field('type', $._type),
      ')',
    )),

    cast_expression: $ => prec(PREC.CAST, choice(
      seq(
        '(',
        field('type', $._type),
        ')',
        field('value', $.expression),
      ),
      seq(
        '(',
        sep1(field('type', $._type), '&'),
        ')',
        field('value', choice($.primary_expression, $.lambda_expression)),
      ),
      // openHAB `as` cast: `(x as DecimalType)`. The `as` keyword replaces the
      // closing paren of Java's cast. `value` is restricted to
      // `primary_expression` (not full `expression`) so `(B.state as T)` does
      // not fork into a parenthesized binary expression at the `as`.
      $.oh_as_cast,
    )),

    assignment_expression: $ => prec.right(PREC.ASSIGN, seq(
      field('left', choice(
        $.identifier,
        $._reserved_identifier,
        $.field_access,
        $.array_access,
      )),
      field('operator', choice('=', '+=', '-=', '*=', '/=', '&=', '|=', '^=', '%=', '<<=', '>>=', '>>>=')),
      field('right', $.expression),
    )),

    binary_expression: $ => choice(
      ...[
        ['<', PREC.REL],
        ['>=', PREC.REL],
        ['<=', PREC.REL],
        ['==', PREC.EQUALITY],
        ['!=', PREC.EQUALITY],
        ['&&', PREC.AND],
        ['||', PREC.OR],
        ['+', PREC.ADD],
        ['-', PREC.ADD],
        ['*', PREC.MULT],
        ['/', PREC.MULT],
        ['&', PREC.BIT_AND],
        ['|', PREC.BIT_OR],
        ['^', PREC.BIT_XOR],
        ['%', PREC.MULT],
        ['<<', PREC.SHIFT],
        ['>>', PREC.SHIFT],
        ['>>>', PREC.SHIFT],
      ].map(([operator, precedence]) =>
        prec.left(precedence, seq(
          field('left', $.expression),
          // @ts-ignore
          field('operator', operator),
          field('right', $.expression),
        )),
      )),

    instanceof_expression: $ => prec.left(PREC.REL, seq(
      field('left', $.expression),
      'instanceof',
      optional('final'),
      choice(
        seq(
          field('right', $._type),
          optional(field('name', choice($.identifier, $._reserved_identifier))),
        ),
        field('pattern', $.record_pattern),
      ),
    )),

    lambda_expression: $ => seq(
      field('parameters', choice(
        $.identifier, $.formal_parameters, $.inferred_parameters, $._reserved_identifier,
      )),
      '->',
      field('body', choice($.expression, $.block)),
    ),

    // openHAB rule lambda: `[| statements ]` or `[| params | statements ]`.
    // Separate from `lambda_expression` because the `[` opener otherwise
    // collides with `array_access` / array creation in `primary_expression`.
    // A single token keeps the lexer from splitting `[|` into `[` + `|`.
    // openHAB rule lambda: `[| statements ]` or `[| params | statements ]`.
    // The pipe after the parameter list is part of the *optional* parameter
    // group — the common parameterless form `[| … ]` has a single `|`.
    // Separate from `lambda_expression` because the `[` opener otherwise
    // collides with `array_access` / array creation in `primary_expression`.
    // A single token keeps the lexer from splitting `[|` into `[` + `|`.
    oh_lambda: $ => prec.right(1, seq(
      token(seq('[', '|')),
      optional(seq(commaSep1($.identifier), '|')),
      repeat($.oh_lambda_statement),
      ']',
    )),

    // A lambda body statement without the trailing `;` that Java requires:
    // openHAB rule DSL omits semicolons between statements. The body is an
    // expression or a control-flow statement — `local_variable_declaration`
    // (`val`/`var …`) is deliberately excluded because its keyword collides
    // with the lambda's parameter list and destabilizes the parse.
    //
    // `oh_lambda_field_statement` (obj.method(…) / obj.field) must outrank the
    // plain-expression branch: after `[|`, `A.b(` is a call, not a type.
    oh_lambda_statement: $ => prec.right(6, choice(
      $.oh_method_call_statement,
      $.oh_lambda_field_statement,
      seq(prec.right(2, $.oh_lambda_expression), optional(';')),
      seq($.method_invocation, optional(';')),
      seq($.if_statement, optional(';')),
      seq($.for_statement, optional(';')),
      seq($.while_statement, optional(';')),
      seq($.block, optional(';')),
    )),

    // `obj.method(…)` / `obj.field = x` / `obj.field` inside a lambda body.
    // Mirrors the object-qualified branch of Java's `method_invocation` /
    // `field_access`, but starts from a bare `identifier` so that after `[|`
    // the `.` cannot fork into a `scoped_type_identifier` (`a.b` as a type).
    // `argument_list` is wrapped in a named node so the conflicts below can
    // steer the parser to this branch when `(` follows `obj.name`.
    oh_lambda_call: $ => prec.right(5, seq(
      field('object', $.identifier), '.', field('name', $.identifier),
      field('arguments', $.argument_list),
    )),

    oh_lambda_field_statement: $ => prec.right(4, choice(
      $.oh_lambda_call,
      seq(field('object', $.identifier), '.', field('field', $.identifier), '=', field('value', $.oh_lambda_expression)),
      seq(field('object', $.identifier), '.', field('field', $.identifier)),
    )),

    // Expression alternatives allowed as a lambda-body statement, excluding
    // the ambiguous `instanceof` tail (kept out of `oh_lambda_statement` to
    // avoid the record-pattern conflict; `x instanceof Y` still parses via
    // the plain-expression branch when no `(` follows).
    oh_lambda_expression: $ => choice(
      $.assignment_expression,
      $.binary_expression,
      $.oh_lambda,
      $.lambda_expression,
      $.ternary_expression,
      $.update_expression,
      $.primary_expression,
      $.unary_expression,
      $.cast_expression,
      $.switch_expression,
      // `instanceof` is excluded here: its `type (` tail collides with the
      // record pattern inside the lambda context and the parser cannot
      // resolve it. `x instanceof Y` still parses when no `(` follows Y via
      // the enclosing `expression` in `oh_lambda_statement`'s other branch.
    ),

    inferred_parameters: $ => seq(
      '(',
      commaSep1(choice($.identifier, $._reserved_identifier)),
      ')',
    ),

    ternary_expression: $ => prec.right(PREC.TERNARY, seq(
      field('condition', $.expression),
      '?',
      field('consequence', $.expression),
      ':',
      field('alternative', $.expression),
    )),

    // openHAB `newHashMap("key" -> "value", …)` entry arrow. Distinct from
    // Java's lambda `->` because both operands are string literals here.
    oh_map_entry: $ => prec.right(seq($._oh_string, '->', $._oh_string)),

    unary_expression: $ => choice(...[
      ['+', PREC.UNARY],
      ['-', PREC.UNARY],
      ['!', PREC.UNARY],
      ['~', PREC.UNARY],
    ].map(([operator, precedence]) =>
      prec.left(precedence, seq(
        // @ts-ignore
        field('operator', operator),
        field('operand', $.expression),
      )),
    )),

    update_expression: $ => prec.left(PREC.UNARY, choice(
      // Post (in|de)crement is evaluated before pre (in|de)crement
      seq($.expression, '++'),
      seq($.expression, '--'),
      seq('++', $.expression),
      seq('--', $.expression),
    )),

    primary_expression: $ => choice(
      $._literal,
      $.class_literal,
      $.identifier,
      $._reserved_identifier,
      $.parenthesized_expression,
      $.object_creation_expression,
      $.field_access,
      $.array_access,
      $.method_invocation,
      $.method_reference,
      $.oh_as_cast,
      $.array_creation_expression,
      $.template_expression,
    ),

    array_creation_expression: $ => prec.right(seq(
      'new',
      repeat($._annotation),
      field('type', $._simple_type),
      choice(
        seq(
          field('dimensions', repeat1($.dimensions_expr)),
          field('dimensions', optional($.dimensions)),
        ),
        seq(
          field('dimensions', $.dimensions),
          field('value', $.array_initializer),
        ),
      ),
    )),

    dimensions_expr: $ => seq(repeat($._annotation), '[', $.expression, ']'),

    parenthesized_expression: $ => seq('(', $.expression, ')'),

    class_literal: $ => prec.dynamic(PREC.CLASS_LITERAL, seq($._unannotated_type, '.', 'class')),

    object_creation_expression: $ => choice(
      $._unqualified_object_creation_expression,
      seq($.primary_expression, '.', $._unqualified_object_creation_expression),
    ),

    _unqualified_object_creation_expression: $ => prec.right(seq(
      'new',
      choice(
        seq(
          repeat($._annotation),
          field('type_arguments', $.type_arguments),
          repeat($._annotation),
        ),
        repeat($._annotation),
      ),
      field('type', $._simple_type),
      field('arguments', $.argument_list),
      optional($.class_body),
    )),

    field_access: $ => seq(
      field('object', choice($.primary_expression, $.super)),
      optional(seq(
        '.',
        $.super,
      )),
      '.',
      field('field', choice($.identifier, $._reserved_identifier, $.this)),
    ),

    template_expression: $ => seq(
      field('template_processor', $.primary_expression),
      '.',
      field('template_argument', $.string_literal),
    ),

    array_access: $ => seq(
      field('array', $.primary_expression),
      '[',
      field('index', $.expression),
      ']',
    ),

    method_invocation: $ => seq(
      choice(
        field('name', choice($.identifier, $._reserved_identifier)),
        seq(
          field('object', choice($.primary_expression, $.super)),
          '.',
          optional(seq(
            $.super,
            '.',
          )),
          field('type_arguments', optional($.type_arguments)),
          field('name', choice($.identifier, $._reserved_identifier)),
        ),
      ),
      field('arguments', $.argument_list),
    ),

    argument_list: $ => seq('(', commaSep(choice($.expression, $.oh_map_entry)), ')'),

    // openHAB rule bodies call static helpers without a terminating `;`
    // (`Thread::sleep(200)`). `method_reference :: identifier ( arguments )`
    // is unambiguous in that position, so accept it as a statement-level
    // invocation. Plain Java keeps requiring the `;` via `expression_statement`.
    oh_method_call_statement: $ => prec.right(seq(
      field('object', choice($._type, $.primary_expression, $.super)),
      '::',
      field('name', choice('new', $.identifier)),
      field('arguments', $.argument_list),
    )),

    method_reference: $ => seq(
      choice($._type, $.primary_expression, $.super),
      '::',
      optional($.type_arguments),
      choice('new', $.identifier),
    ),

    type_arguments: $ => seq(
      '<',
      commaSep(choice($._type, $.wildcard)),
      '>',
    ),

    wildcard: $ => seq(
      repeat($._annotation),
      '?',
      optional($._wildcard_bounds),
    ),

    _wildcard_bounds: $ => choice(
      seq('extends', $._type),
      seq($.super, $._type),
    ),

    dimensions: $ => prec.right(repeat1(
      seq(repeat($._annotation), '[', ']'),
    )),

    switch_expression: $ => seq(
      'switch',
      field('condition', $.parenthesized_expression),
      field('body', $.switch_block),
    ),

    switch_block: $ => seq(
      '{',
      choice(
        repeat($.switch_block_statement_group),
        repeat($.switch_rule),
      ),
      '}',
    ),

    switch_block_statement_group: $ => prec.left(seq(
      repeat1(seq($.switch_label, ':')),
      repeat($.statement),
    )),

    switch_rule: $ => seq(
      $.switch_label,
      '->',
      choice($.expression_statement, $.throw_statement, $.block),
    ),

    switch_label: $ => choice(
      seq('case',
        choice(
          $.pattern,
          commaSep1($.expression),
        ),
        optional($.guard),
      ),
      'default',
    ),

    pattern: $ => choice(
      $.type_pattern,
      $.record_pattern,
    ),
    type_pattern: $ => seq($._unannotated_type, choice($.identifier, $._reserved_identifier)),
    record_pattern: $ => seq(choice($.identifier, $._reserved_identifier, $.generic_type), $.record_pattern_body),
    record_pattern_body: $ => seq('(', commaSep(choice($.record_pattern_component, $.record_pattern)), ')'),
    record_pattern_component: $ => choice(
      $.underscore_pattern,
      seq(
        $._unannotated_type,
        choice($.identifier, $._reserved_identifier),
      ),
    ),

    underscore_pattern: _ => '_',

    guard: $ => seq('when', $.expression),

    // Statements

    statement: $ => choice(
      $.declaration,
      $.expression_statement,
      $.labeled_statement,
      $.if_statement,
      $.while_statement,
      $.for_statement,
      $.enhanced_for_statement,
      $.block,
      ';',
      $.assert_statement,
      $.do_statement,
      $.break_statement,
      $.continue_statement,
      $.return_statement,
      $.yield_statement,
      $.switch_expression, // switch statements and expressions are identical
      $.synchronized_statement,
      $.local_variable_declaration,
      $.throw_statement,
      $.try_statement,
      $.try_with_resources_statement,
      // openHAB: allowed inside rule bodies and `{ }` blocks
      $._oh_declaration,
      $.oh_method_call_statement,
      $.oh_var_declaration,
      // openHAB rule bodies call plain functions without a terminating `;` and
      // without an object (`sendHttpPutRequest(…)`, `logInfo(…)`). The missing
      // semicolon is what distinguishes this from Java's `expression_statement`.
      $.oh_call_statement,
      // openHAB rule bodies also call methods on objects without `;`
      // (`A.sendCommand(ON)`).
      $.oh_field_call_statement,
    ),

    block: $ => seq(
      '{', repeat($.statement), '}',
    ),

    expression_statement: $ => seq(
      $.expression,
      ';',
    ),

    labeled_statement: $ => seq(
      $.identifier, ':', $.statement,
    ),

    assert_statement: $ => choice(
      seq('assert', $.expression, ';'),
      seq('assert', $.expression, ':', $.expression, ';'),
    ),

    do_statement: $ => seq(
      'do',
      field('body', $.statement),
      'while',
      field('condition', $.parenthesized_expression),
      ';',
    ),

    break_statement: $ => seq('break', optional($.identifier), ';'),

    continue_statement: $ => seq('continue', optional($.identifier), ';'),

    return_statement: $ => seq(
      'return',
      optional($.expression),
      ';',
    ),

    yield_statement: $ => seq(
      'yield',
      $.expression,
      ';',
    ),

    synchronized_statement: $ => seq(
      'synchronized',
      $.parenthesized_expression,
      field('body', $.block),
    ),

    throw_statement: $ => seq('throw', $.expression, ';'),

    try_statement: $ => seq(
      'try',
      field('body', $.block),
      choice(
        repeat1($.catch_clause),
        seq(repeat($.catch_clause), $.finally_clause),
      ),
    ),

    catch_clause: $ => seq(
      'catch',
      '(',
      $.catch_formal_parameter,
      ')',
      field('body', $.block),
    ),

    catch_formal_parameter: $ => seq(
      optional($.modifiers),
      $.catch_type,
      $._variable_declarator_id,
    ),

    catch_type: $ => sep1($._unannotated_type, '|'),

    finally_clause: $ => seq('finally', $.block),

    try_with_resources_statement: $ => seq(
      'try',
      field('resources', $.resource_specification),
      field('body', $.block),
      repeat($.catch_clause),
      optional($.finally_clause),
    ),

    resource_specification: $ => seq(
      '(', sep1($.resource, ';'), optional(';'), ')',
    ),

    resource: $ => choice(
      seq(
        optional($.modifiers),
        field('type', $._unannotated_type),
        $._variable_declarator_id,
        '=',
        field('value', $.expression),
      ),
      $.identifier,
      $.field_access,
    ),

    if_statement: $ => prec.right(seq(
      'if',
      field('condition', $.parenthesized_expression),
      field('consequence', $.statement),
      optional(seq('else', field('alternative', $.statement))),
    )),

    while_statement: $ => seq(
      'while',
      field('condition', $.parenthesized_expression),
      field('body', $.statement),
    ),

    for_statement: $ => seq(
      'for', '(',
      choice(
        field('init', $.local_variable_declaration),
        seq(
          commaSep(field('init', $.expression)),
          ';',
        ),
      ),
      field('condition', optional($.expression)), ';',
      commaSep(field('update', $.expression)), ')',
      field('body', $.statement),
    ),

    enhanced_for_statement: $ => seq(
      'for',
      '(',
      optional($.modifiers),
      field('type', $._unannotated_type),
      $._variable_declarator_id,
      ':',
      field('value', $.expression),
      ')',
      field('body', $.statement),
    ),

    // Annotations

    _annotation: $ => choice(
      $.marker_annotation,
      $.annotation,
    ),

    marker_annotation: $ => seq(
      '@',
      field('name', $._name),
    ),

    annotation: $ => seq(
      '@',
      field('name', $._name),
      field('arguments', $.annotation_argument_list),
    ),

    annotation_argument_list: $ => seq(
      '(',
      choice(
        $._element_value,
        commaSep($.element_value_pair),
      ),
      ')',
    ),

    element_value_pair: $ => seq(
      field('key', choice($.identifier, $._reserved_identifier)),
      '=',
      field('value', $._element_value),
    ),

    _element_value: $ => prec(PREC.ELEMENT_VAL, choice(
      $.expression,
      $.element_value_array_initializer,
      $._annotation,
    )),

    element_value_array_initializer: $ => seq(
      '{',
      commaSep($._element_value),
      optional(','),
      '}',
    ),

    // Declarations

    declaration: $ => prec(PREC.DECL, choice(
      $.module_declaration,
      $.package_declaration,
      $.import_declaration,
      $.class_declaration,
      $.record_declaration,
      $.interface_declaration,
      $.annotation_type_declaration,
      $.enum_declaration,
    )),

    module_declaration: $ => seq(
      repeat($._annotation),
      optional('open'),
      'module',
      field('name', $._name),
      field('body', $.module_body),
    ),

    module_body: $ => seq(
      '{',
      repeat($.module_directive),
      '}',
    ),

    module_directive: $ => choice(
      $.requires_module_directive,
      $.exports_module_directive,
      $.opens_module_directive,
      $.uses_module_directive,
      $.provides_module_directive,
    ),

    requires_module_directive: $ => seq(
      'requires',
      repeat(field('modifiers', $.requires_modifier)),
      field('module', $._name),
      ';',
    ),

    requires_modifier: _ => choice(
      'transitive',
      'static',
    ),

    exports_module_directive: $ => seq(
      'exports',
      field('package', $._name),
      optional(seq(
        'to',
        field('modules', $._name),
        repeat(seq(',', field('modules', $._name))),
      )),
      ';',
    ),

    opens_module_directive: $ => seq(
      'opens',
      field('package', $._name),
      optional(seq(
        'to',
        field('modules', $._name),
        repeat(seq(',', field('modules', $._name))),
      )),
      ';',
    ),

    uses_module_directive: $ => seq(
      'uses',
      field('type', $._name),
      ';',
    ),

    provides_module_directive: $ => seq(
      'provides',
      field('provided', $._name),
      'with',
      $._name,
      repeat(seq(',', (field('provider', $._name)))),
      ';',
    ),

    package_declaration: $ => seq(
      repeat($._annotation),
      'package',
      $._name,
      ';',
    ),

    import_declaration: $ => seq(
      'import',
      optional('static'),
      $._name,
      optional(seq('.', $.asterisk)),
      ';',
    ),

    asterisk: _ => '*',

    enum_declaration: $ => seq(
      optional($.modifiers),
      'enum',
      field('name', $.identifier),
      field('interfaces', optional($.super_interfaces)),
      field('body', $.enum_body),
    ),

    enum_body: $ => seq(
      '{',
      commaSep($.enum_constant),
      optional(','),
      optional($.enum_body_declarations),
      '}',
    ),

    enum_body_declarations: $ => seq(
      ';',
      repeat($._class_body_declaration),
    ),

    enum_constant: $ => (seq(
      optional($.modifiers),
      field('name', $.identifier),
      field('arguments', optional($.argument_list)),
      field('body', optional($.class_body)),
    )),

    class_declaration: $ => seq(
      optional($.modifiers),
      'class',
      field('name', $.identifier),
      optional(field('type_parameters', $.type_parameters)),
      optional(field('superclass', $.superclass)),
      optional(field('interfaces', $.super_interfaces)),
      optional(field('permits', $.permits)),
      field('body', $.class_body),
    ),

    modifiers: $ => repeat1(choice(
      $._annotation,
      'public',
      'protected',
      'private',
      'abstract',
      'static',
      'final',
      'strictfp',
      'default',
      'synchronized',
      'native',
      'transient',
      'volatile',
      'sealed',
      'non-sealed',
    )),

    type_parameters: $ => seq(
      '<', commaSep1($.type_parameter), '>',
    ),

    type_parameter: $ => seq(
      repeat($._annotation),
      alias($.identifier, $.type_identifier),
      optional($.type_bound),
    ),

    type_bound: $ => seq('extends', $._type, repeat(seq('&', $._type))),

    superclass: $ => seq(
      'extends',
      $._type,
    ),

    super_interfaces: $ => seq(
      'implements',
      $.type_list,
    ),

    type_list: $ => seq(
      $._type,
      repeat(seq(',', $._type)),
    ),

    permits: $ => seq(
      'permits',
      $.type_list,
    ),

    class_body: $ => seq(
      '{',
      repeat($._class_body_declaration),
      '}',
    ),

    _class_body_declaration: $ => choice(
      $.field_declaration,
      $.record_declaration,
      $.method_declaration,
      $.compact_constructor_declaration, // For records.
      $.class_declaration,
      $.interface_declaration,
      $.annotation_type_declaration,
      $.enum_declaration,
      $.block,
      $.static_initializer,
      $.constructor_declaration,
      ';',
    ),

    static_initializer: $ => seq(
      'static',
      $.block,
    ),

    constructor_declaration: $ => seq(
      optional($.modifiers),
      $._constructor_declarator,
      optional($.throws),
      field('body', $.constructor_body),
    ),

    _constructor_declarator: $ => seq(
      field('type_parameters', optional($.type_parameters)),
      field('name', $.identifier),
      field('parameters', $.formal_parameters),
    ),

    constructor_body: $ => seq(
      '{',
      optional($.explicit_constructor_invocation),
      repeat($.statement),
      '}',
    ),

    explicit_constructor_invocation: $ => seq(
      choice(
        seq(
          field('type_arguments', optional($.type_arguments)),
          field('constructor', choice($.this, $.super)),
        ),
        seq(
          field('object', choice($.primary_expression)),
          '.',
          field('type_arguments', optional($.type_arguments)),
          field('constructor', $.super),
        ),
      ),
      field('arguments', $.argument_list),
      ';',
    ),

    _name: $ => choice(
      $.identifier,
      $._reserved_identifier,
      $.scoped_identifier,
    ),

    scoped_identifier: $ => seq(
      field('scope', $._name),
      '.',
      field('name', $.identifier),
    ),

    field_declaration: $ => seq(
      optional($.modifiers),
      field('type', $._unannotated_type),
      $._variable_declarator_list,
      ';',
    ),

    record_declaration: $ => seq(
      optional($.modifiers),
      'record',
      field('name', $.identifier),
      optional(field('type_parameters', $.type_parameters)),
      field('parameters', $.formal_parameters),
      optional(field('interfaces', $.super_interfaces)),
      field('body', $.class_body),
    ),

    annotation_type_declaration: $ => seq(
      optional($.modifiers),
      '@interface',
      field('name', $.identifier),
      field('body', $.annotation_type_body),
    ),

    annotation_type_body: $ => seq(
      '{',
      repeat(choice(
        $.annotation_type_element_declaration,
        $.constant_declaration,
        $.class_declaration,
        $.interface_declaration,
        $.enum_declaration,
        $.annotation_type_declaration,
        ';',
      )),
      '}',
    ),

    annotation_type_element_declaration: $ => seq(
      optional($.modifiers),
      field('type', $._unannotated_type),
      field('name', choice($.identifier, $._reserved_identifier)),
      '(', ')',
      field('dimensions', optional($.dimensions)),
      optional($._default_value),
      ';',
    ),

    _default_value: $ => seq(
      'default',
      field('value', $._element_value),
    ),

    interface_declaration: $ => seq(
      optional($.modifiers),
      'interface',
      field('name', $.identifier),
      field('type_parameters', optional($.type_parameters)),
      optional($.extends_interfaces),
      optional(field('permits', $.permits)),
      field('body', $.interface_body),
    ),

    extends_interfaces: $ => seq(
      'extends',
      $.type_list,
    ),

    interface_body: $ => seq(
      '{',
      repeat(choice(
        $.constant_declaration,
        $.enum_declaration,
        $.method_declaration,
        $.class_declaration,
        $.interface_declaration,
        $.record_declaration,
        $.annotation_type_declaration,
        ';',
      )),
      '}',
    ),

    constant_declaration: $ => seq(
      optional($.modifiers),
      field('type', $._unannotated_type),
      $._variable_declarator_list,
      ';',
    ),

    _variable_declarator_list: $ => commaSep1(
      field('declarator', $.variable_declarator),
    ),

    variable_declarator: $ => seq(
      $._variable_declarator_id,
      optional(seq('=', field('value', $._variable_initializer))),
    ),

    _variable_declarator_id: $ => seq(
      field('name', choice($.identifier, $._reserved_identifier, $.underscore_pattern)),
      field('dimensions', optional($.dimensions)),
    ),

    _variable_initializer: $ => choice(
      $.expression,
      $.array_initializer,
    ),

    array_initializer: $ => seq(
      '{',
      commaSep($._variable_initializer),
      optional(','),
      '}',
    ),

    // Types

    _type: $ => choice(
      $._unannotated_type,
      $.annotated_type,
    ),

    _unannotated_type: $ => choice(
      $._simple_type,
      $.array_type,
    ),

    _simple_type: $ => choice(
      $.void_type,
      $.integral_type,
      $.floating_point_type,
      $.boolean_type,
      alias($.identifier, $.type_identifier),
      $.scoped_type_identifier,
      $.generic_type,
    ),

    annotated_type: $ => seq(
      repeat1($._annotation),
      $._unannotated_type,
    ),

    scoped_type_identifier: $ => seq(
      choice(
        alias($.identifier, $.type_identifier),
        $.scoped_type_identifier,
        $.generic_type,
      ),
      '.',
      repeat($._annotation),
      alias($.identifier, $.type_identifier),
    ),

    generic_type: $ => prec.dynamic(PREC.GENERIC, seq(
      choice(
        alias($.identifier, $.type_identifier),
        $.scoped_type_identifier,
      ),
      $.type_arguments,
    )),

    array_type: $ => seq(
      field('element', $._unannotated_type),
      field('dimensions', $.dimensions),
    ),

    integral_type: _ => choice(
      'byte',
      'short',
      'int',
      'long',
      'char',
    ),

    floating_point_type: _ => choice(
      'float',
      'double',
    ),

    boolean_type: _ => 'boolean',

    void_type: _ => 'void',

    _method_header: $ => seq(
      optional(seq(
        field('type_parameters', $.type_parameters),
        repeat($._annotation),
      )),
      field('type', $._unannotated_type),
      $._method_declarator,
      optional($.throws),
    ),

    _method_declarator: $ => seq(
      field('name', choice($.identifier, $._reserved_identifier)),
      field('parameters', $.formal_parameters),
      field('dimensions', optional($.dimensions)),
    ),

    formal_parameters: $ => seq(
      '(',
      choice(
        $.receiver_parameter,
        seq(
          optional(seq($.receiver_parameter, ',')),
          commaSep(choice($.formal_parameter, $.spread_parameter)),
        ),
      ),
      ')',
    ),

    formal_parameter: $ => seq(
      optional($.modifiers),
      field('type', $._unannotated_type),
      $._variable_declarator_id,
    ),

    receiver_parameter: $ => seq(
      repeat($._annotation),
      $._unannotated_type,
      repeat(seq($.identifier, '.')),
      $.this,
    ),

    spread_parameter: $ => seq(
      optional($.modifiers),
      $._unannotated_type,
      '...',
      repeat($._annotation),
      $.variable_declarator,
    ),

    throws: $ => seq(
      'throws', commaSep1($._type),
    ),

    local_variable_declaration: $ => seq(
      optional($.modifiers),
      field('type', $._unannotated_type),
      $._variable_declarator_list,
      ';',
    ),

    method_declaration: $ => seq(
      optional($.modifiers),
      $._method_header,
      choice(field('body', $.block), ';'),
    ),

    compact_constructor_declaration: $ => seq(
      optional($.modifiers),
      field('name', $.identifier),
      field('body', $.block),
    ),

    _reserved_identifier: $ => choice(
      prec(-3, alias(
        choice(
          'open',
          'module',
          'record',
          'with',
          'sealed',
        ),
        $.identifier,
      )),
      alias('yield', $.identifier),
    ),

    this: _ => 'this',

    super: _ => 'super',

    // https://docs.oracle.com/javase/specs/jls/se8/html/jls-3.html#jls-IdentifierChars
    identifier: _ => /[\p{XID_Start}_$][\p{XID_Continue}\u00A2_$]*/,

    line_comment: _ => token(prec(PREC.COMMENT, seq('//', /[^\n]*/))),

    // http://stackoverflow.com/questions/13014947/regex-to-match-a-c-style-multiline-comment/36328890#36328890
    block_comment: _ => token(prec(PREC.COMMENT,
      seq(
        '/*',
        /[^*]*\*+([^/*][^*]*\*+)*/,
        '/',
      ),
    )),

    // =======================================================================
    // openHAB additions
    // =======================================================================

    _oh_declaration: $ => choice(
      $.rule_declaration,
      // A sitemap widget line is tried before the generic item_definition:
      // in a `.sitemap` body `Widget key=value` has no item name, so letting
      // item_definition claim the type word first mis-parses `url="…"` as a
      // label. In `.items` files the widget words never appear, so ordering
      // here is harmless there.
      $.sitemap_widget,
      $.sitemap_frame,
      $.item_definition,
      $.thing_definition,
      $.bridge_body,
      $.sitemap_definition,
      $.persist_section,
      $.channel_section,
      $.channel_definition,
      $.thing_config,
    ),

    // -----------------------------------------------------------------------
    // .rules / .script: `rule "x" when <triggers> then <body> end`
    // -----------------------------------------------------------------------
    //
    // The body is plain Java statements. `end` is a keyword *only* when it
    // would otherwise start a statement, so an identifier called `end` inside
    // an expression keeps working.

    rule_declaration: $ => seq(
      choice('rule', 'script'),
      field('name', $._oh_string),
      $._oh_rule_part,
    ),

    _oh_rule_part: $ => seq(
      'when',
      field('triggers', $._oh_triggers),
      'then',
      field('body', $.rule_body),
      'end',
    ),

    // `statement` already includes openHAB declarations, so listing them here
    // too would create two interpretations of the same tokens.
    rule_body: $ => repeat1($.statement),

    // Triggers are `or`-separated groups of `and`-separated conditions.
    _oh_triggers: $ => prec.right(seq(
      $.trigger_condition,
      repeat(choice(
        seq('or', $.trigger_condition),
        seq('and', $.trigger_condition),
      )),
    )),

    trigger_condition: $ => choice(
      // `Item Name changed`, `Item Name changed to ON`, `Item Name received update`
      seq('Item', field('item', $.identifier), $._oh_item_event),
      // `Member of Group changed …`
      seq('Member', 'of', '(', field('group', $.identifier), ')', $._oh_item_event),
      // `Thing uid changed`, `Thing uid received update`
      seq('Thing', field('thing', $.thing_uid), choice('changed', seq('received', choice('update', 'command')))),
      // `System started`, `System shuts down`
      seq('System', field('event', choice('started', 'shuts', 'shutdown'))),
      // `Time cron "0 0/5 * * * ?"`, `Time is noon`, `Time is midnight`
      seq('Time', $._oh_time_event),
      // `Channel "uid" triggered`, `Member of(grp) changed`
      seq('Channel', field('channel', $._oh_string), optional('triggered'), optional(choice('START', 'STOP', 'EVENT'))),
    ),

    _oh_item_event: $ => choice(
      seq('changed', optional(seq('from', $.trigger_state)), optional(seq('to', $.trigger_state))),
      seq('received', optional(choice('update', 'command')), optional($.trigger_state)),
      seq('updated', optional(seq('to', $.trigger_state))),
    ),

    _oh_time_event: $ => choice(
      seq('cron', field('cron', $._oh_string)),
      seq('is', field('time', $.identifier)),
    ),

    trigger_state: $ => choice(
      $.identifier,
      $.decimal_integer_literal,
      $.decimal_floating_point_literal,
      $._oh_string,
    ),

    // -----------------------------------------------------------------------
    // .items: `Type Name "Label [%s]" <icon> (g1, g2) ["Tag"] { meta }`
    // -----------------------------------------------------------------------
    //
    // `Group:Number:AVG` and `Number:Temperature` put a unit or aggregation
    // type after the main type, separated by `:`.

    item_definition: $ => prec.right(3, seq(
      field('type', $.item_type),
      // The name may itself be an aggregation-style keyword token (`AVG`, …):
      // in `Group:Number:AVG g …` the parser sees `AVG` right after the `:`
      // chain and must not consume it as the item name.
      field('name', choice($.identifier, $.aggregation_function)),
      // Fixed order, as openHAB requires: label, icon, groups, tags, metadata.
      // A `repeat` over a choice does not work here: each clause is a distinct
      // node, so the parser stops after the first one that matches.
      optional(field('label', $._oh_string)),
      optional(field('icon', $.item_icon)),
      optional(field('groups', $.group_list)),
      optional(field('tags', $.tag_list)),
      // `Location` items take a `[ latitude=…, longitude=… ]` config block in
      // place of (or in addition to) the tag list.
      optional(field('location_config', $.thing_config)),
      optional(field('metadata', $.item_metadata)),
      // A bare `Switch Name` parses as Java; openHAB always has at least a
      // label, so requiring a non-empty definition would only lose recovery.
    )),

    item_type: $ => prec.right(2, seq(
      field('base', alias($.dsl_type_word, $.item_type_base)),
      // `:Number`, `:AVG` — colon-separated unit/aggregation segments. A bare
      // base type (`Switch A …`) has none. `AVG`/`SUM`/… are distinct tokens
      // from `identifier`, so `Group:Number:AVG` cannot be misread as a
      // labeled statement once the conflict below is declared.
      repeat(seq(':', field('sub', choice($.identifier, $.aggregation_word)))),
      // `Group:Contact:OR(OPEN, CLOSED)` — aggregation function with args.
      optional(seq(':', field('aggregation', $.aggregation_function))),
    )),

    // Aggregation keywords are lexed as their own tokens (not `identifier`),
    // which is what lets `Group:Number:AVG g …` disambiguate from a Java
    // labeled statement at the `:`.
    aggregation_word: _ => choice('OR', 'AND', 'SUM', 'MIN', 'MAX', 'AVG', 'COUNT', 'NAND', 'NOR'),

    aggregation_function: $ => seq(
      field('name', $.aggregation_word),
      '(', commaSep($.identifier), ')',
    ),

    // openHAB reuses the same words for item types (`.items`) and sitemap
    // widgets (`Dimmer item=…`, `Switch item=…`). The two cannot be told apart
    // from the token alone, so both use one node and the queries decide by
    // context (an item type is followed by an identifier, a widget by `item=`).
    dsl_type_word: _ => choice(
      'Color', 'Contact', 'DateTime', 'Dimmer', 'Group', 'Image', 'Location',
      'Number', 'Player', 'Rollershutter', 'String', 'Switch', 'Call',
      'StringList', 'QuantityType',
      'Default', 'Selection', 'Setpoint', 'Slider', 'Colorpicker',
      'Chart', 'Webview', 'Video', 'Mapview',
    ),

    // `<light>`; the angle brackets are otherwise Java comparison operators.
    item_icon: $ => seq('<', field('name', $.identifier), '>'),

    group_list: $ => seq('(', commaSep($.identifier), ')'),

    tag_list: $ => seq('[', commaSep($._oh_string), ']'),

    // `{ channel="…", autoupdate="false" }` plus nested `ns { key=value }`
    // metadata blocks such as `AutoRefresh { strategy="timer" }`. Entries are
    // newline-separated, not comma-separated.
    item_metadata: $ => seq('{', repeat($.metadata_entry), '}'),

    metadata_entry: $ => choice(
      seq(field('key', $.metadata_key), '=', field('value', $.metadata_value),
          optional(field('config', $.metadata_config))),
      seq(field('key', $.metadata_key), field('block', $.metadata_block)),
    ),

    metadata_key: $ => choice($.identifier, $.metadata_namespaced_key),

    // `core:stateDescription`
    metadata_namespaced_key: $ => seq(
      field('namespace', $.identifier), ':', field('name', $.identifier),
    ),

    metadata_value: $ => choice($._oh_string, $.decimal_integer_literal, $.decimal_floating_point_literal, $.identifier, $.true, $.false),

    metadata_config: $ => seq('[', commaSep(seq(field('key', $.identifier), '=', field('value', $.metadata_value))), ']'),

    metadata_block: $ => seq('{', repeat($.metadata_entry), '}'),

    // openHAB rule bodies call plain functions without a terminating `;` and
    // without an object (`sendHttpPutRequest(…)`, `logInfo(…)`). The missing
    // semicolon is what distinguishes this from Java's `expression_statement`.
    oh_call_statement: $ => prec.right(seq(
      field('name', choice($.identifier, $._reserved_identifier)),
      field('arguments', $.argument_list),
    )),

    // openHAB rule DSL types: `var Timer wakeupTimer = null`, `val Number x`.
    // The type is a plain identifier (or qualified name) — restricting it
    // keeps `var x = …` from forking into a Java generic declaration.
    oh_var_type: _ => choice('Timer', 'Number', 'String', 'Switch', 'DateTime', 'DecimalType', 'OnOffType'),

    // openHAB rule DSL variable declaration without `;`. `val`/`var` are not
    // Java keywords, so Java parses them as the *type* of a
    // `local_variable_declaration`; this rule gives them a dedicated node.
    oh_var_declaration: $ => prec.right(3, seq(
      field('keyword', choice('val', 'var')),
      optional(field('type', $.oh_var_type)),
      field('name', $.identifier),
      optional(seq('=', field('value', $.oh_var_value))),
    )),

    // The RHS of a `val`/`var` in a rule body: a full expression, but the
    // parser must not extend a bare primary into `array_access` (`x[0]`)
    // inside this context — that interpretation belongs to the enclosing
    // statement. Listing it separately keeps the conflict localized.
    oh_var_value: $ => prec.right(4, choice(
      $.assignment_expression,
      $.binary_expression,
      $.oh_lambda,
      $.lambda_expression,
      $.ternary_expression,
      $.update_expression,
      $.cast_expression,
      $.oh_as_cast,
      $.instanceof_expression,
      $.switch_expression,
      $.method_invocation,
      $.field_access,
      $.unary_expression,
      $.primary_expression,
    )),
    // (`A.sendCommand(ON)`). High precedence so it wins over the Java
    // `identifier . identifier` interpretations at a statement start.
    oh_field_call_statement: $ => prec.right(10, seq(
      field('object', $.identifier),
      '.',
      field('name', choice($.identifier, $._reserved_identifier)),
      field('arguments', $.argument_list),
    )),

    // -----------------------------------------------------------------------
    // .things: `Thing uid:type:id "Label" (bridge) [ config ] { Channels: … }`
    // -----------------------------------------------------------------------

    // `Bridge hue:bridge:office "…" [ … ] {` — the `{` may follow the config
    // on the same line; a newline between them is just whitespace (extras).
    thing_definition: $ => prec.right(seq(
      field('kind', choice('Thing', 'Bridge')),
      field('uid', $.thing_uid),
      optional(field('label', $._oh_string)),
      optional(field('bridge', seq('(', $.qualified_name, ')'))),
      optional(field('config', $.thing_config)),
      // openHAB allows the `{ … }` body to appear on the next line (after the
      // header and/or the `[ … ]` config), and a Bridge's top-level `{ … }`
      // block holds the nested Things.
      optional(field('body', choice($.thing_body, $.bridge_body))),
    )),

    // openHAB: `Thing 0210 bulb1 "…"` — the UID may be space-separated
    // (`Thing topic logging …`), and a Bridge's nested Thing uses the numeric
    // form. The conflict declared up top keeps the parser from reading
    // `0210 bulb1` as a type + name declaration.

    // A `{ … }` block following a Bridge header at top level contains Thing
    // definitions (mqttbroker.things: `Bridge mqtt:broker:nuc "…" [ … ]` then
    // `{ Thing topic x "…" { Channels: … } … }` on the next lines).
    bridge_body: $ => prec.right(seq('{', repeat($._oh_declaration), '}')),

    // `mqtt:broker:nuc`, `exec:command:shutdownpc`, `topic logging`,
    // `exec:command:poweroutletA-control` — binding plus colon-separated
    // segments; openHAB also allows a *space*-separated final segment
    // (`Thing topic logging …`). The final segment may contain `-`.
    thing_uid: $ => seq(
      field('binding', $.identifier),
      choice(
        repeat1(seq(':', field('segment', $.thing_uid_segment))),
        field('segment', $.thing_uid_segment),
      ),
    ),

    thing_uid_segment: _ => token(seq(
      /[A-Za-z_][A-Za-z0-9_]*/,
      repeat(seq('-', /[A-Za-z0-9_]+/)),
    )),

    qualified_name: $ => sep1($.identifier, ':'),

    thing_config: $ => seq('[', commaSep($.thing_config_pair), ']'),

    thing_config_pair: $ => seq(field('key', $.identifier), '=', field('value', $.metadata_value)),

    thing_body: $ => seq('{', repeat($._oh_declaration), '}'),

    channel_section: $ => prec.right(seq('Channels', ':', repeat1($.channel_definition))),

    // `Type switch : state "Label" [ stateTopic="…" ]` — channel types may be
    // multi-word (`sensor_binary`); the id after the second `:` is a plain
    // identifier.
    channel_type: _ => choice(
      'string', 'number', 'switch', 'dimmer', 'color', 'contact', 'datetime',
      'rollershutter', 'image', 'location', 'player', 'sensor_binary',
      'sensor_door', 'sensor_motion', 'sensor_temperature', 'sensor_humidity',
    ),

    channel_definition: $ => prec.right(seq(
      'Type',
      // `Type number : temperature` — channel type may carry a `:unit` suffix.
      field('channel_type', $.channel_type),
      repeat(seq(':', field('unit', $.identifier))),
      ':',
      field('id', $.identifier),
      optional(field('label', $._oh_string)),
      optional(field('config', $.thing_config)),
    )),

    // -----------------------------------------------------------------------
    // .sitemap: `sitemap x label="…" { Frame label="…" { Widget item=… } }`
    // -----------------------------------------------------------------------

    sitemap_definition: $ => seq(
      'sitemap',
      field('name', $.identifier),
      // `label="…"` is an attribute pair, not a bare string.
      repeat(field('attribute', $.sitemap_attribute)),
      field('body', $.sitemap_body),
    ),

    sitemap_body: $ => seq('{', repeat($._oh_declaration), '}'),

    // `Frame label="x" { … }`; the label is optional (openHAB allows bare
    // `Frame {`), and `Text label="x" { … }` is a nested frame.
    // `Frame label="x" { … }`; the label is optional (openHAB allows bare
    // `Frame {`), and `Text label="x" { … }` is a nested frame.
    sitemap_frame: $ => prec.right(seq(
      field('frame_kind', alias($.frame_word, $.sitemap_widget_type)),
      optional(field('item', $._oh_sitemap_item)),
      repeat(field('attribute', $.sitemap_attribute)),
      field('body', $.sitemap_body),
    )),

    // Separate from `dsl_type_word` so that `Frame`/`Text` never compete with
    // item types; only `.sitemap` files contain these tokens.
    frame_word: _ => choice('Frame', 'Text'),

    sitemap_widget: $ => prec.right(seq(
      field('widget', alias(choice($.dsl_type_word, $.frame_word), $.sitemap_widget_type)),
      repeat(choice(
        field('item', $._oh_sitemap_item),
        field('attribute', $.sitemap_attribute),
      )),
      optional(field('body', $.sitemap_body)),
    )),

    _oh_sitemap_item: $ => seq('item', '=', field('item', $.qualified_name)),

    // A widget attribute key is a plain identifier, but `item` is special:
    // `item=X` selects the bound item, everything else is an attribute.
    // Keeping `item` out of the generic key keeps `item=…` from being read
    // as `key=value` with a `qualified_name` value.
    _oh_sitemap_attr_key: _ => choice('label', 'icon', $.identifier),

    // `label="x" icon="y" mappings=[Handle="Label"] visibility=[…]`
    sitemap_attribute: $ => choice(
      seq(field('key', choice('label', 'icon')), '=', field('value', $._oh_string)),
      seq(field('key', $.identifier), '=', field('value', $.sitemap_value)),
    ),

    sitemap_value: $ => choice(
      $._oh_string,
      $.decimal_integer_literal,
      $.decimal_floating_point_literal,
      $.identifier,
      $.sitemap_mappings,
      $.sitemap_visibility,
    ),

    // `mappings=["ON"="Aus", 1="Dimmed"]`
    sitemap_mappings: $ => seq('[', commaSep($.sitemap_mapping), ']'),

    sitemap_mapping: $ => seq(
      field('command', choice($._oh_string, $.decimal_integer_literal)),
      '=',
      field('label', $._oh_string),
    ),

    // `visibility=[VacationMode==ON, Other!=OFF]`
    sitemap_visibility: $ => seq('[', commaSep($.sitemap_condition), ']'),

    sitemap_condition: $ => seq(
      field('item', $.qualified_name),
      field('operator', choice('==', '!=')),
      field('value', choice($.identifier, $._oh_string, $.decimal_integer_literal)),
    ),

    // -----------------------------------------------------------------------
    // .persist: `Strategies { }` / `Items { }`
    // -----------------------------------------------------------------------

    persist_section: $ => choice(
      $.persist_strategies_section,
      $.persist_items_section,
    ),

    // `Strategies { everyHour : "0 0 * * * ?"  default = "everyDay" }`
    // Entries are newline-separated, not comma-separated.
    persist_strategies_section: $ => seq(
      'Strategies',
      '{',
      repeat($.persist_strategy),
      '}',
    ),

    // `Items { Kitchen_Light, g* : strategy = everyChange, restoreOnStartup }`
    // Entries are newline-separated.
    persist_items_section: $ => seq(
      'Items',
      '{',
      repeat($.persist_config),
      '}',
    ),

    persist_strategy: $ => choice(
      seq(field('name', $.identifier), ':', choice($._oh_string, $.identifier)),
      // `default = "everyDay"` — the default strategy alias.
      seq('default', '=', choice($._oh_string, $.identifier)),
    ),

    persist_config: $ => prec.right(seq(
      field('items', commaSep($.persist_item_pattern)),
      ':',
      'strategy',
      '=',
      field('strategies', commaSep($.persist_strategy_name)),
    )),

    // `Kitchen_Light`, `gTemperature*`, `*`
    persist_item_pattern: $ => seq(
      field('name', choice($.identifier, '*')),
      optional('*'),
    ),

    persist_strategy_name: $ => choice(
      $.identifier,
      // `everyChange`, `everyUpdate`, `everyMinute`, `everyHour`, `everyDay`, `restoreOnStartup`
      'restoreOnStartup',
    ),

    // -----------------------------------------------------------------------
    // Strings: openHAB accepts single quotes in rule bodies and sitemaps,
    // unlike Java. This is an addition, not a replacement.
    // -----------------------------------------------------------------------

    _oh_string: $ => choice($.string_literal, $.single_quoted_string),

    single_quoted_string: _ => token(seq("'", repeat(choice(
      /[^'\\\n]/,
      seq('\\', /./),
    )), "'")),
  },
});

/**
 * Creates a rule to match one or more of the rules separated by `separator`
 *
 * @param {RuleOrLiteral} rule
 *
 * @param {RuleOrLiteral} separator
 *
 * @returns {SeqRule}
 */
function sep1(rule, separator) {
  return seq(rule, repeat(seq(separator, rule)));
}

/**
 * Creates a rule to match one or more of the rules separated by a comma
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {SeqRule}
 */
function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

/**
 * Creates a rule to optionally match one or more of the rules separated by a comma
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {ChoiceRule}
 */
function commaSep(rule) {
  return optional(commaSep1(rule));
}
