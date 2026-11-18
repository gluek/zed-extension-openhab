use std::path::PathBuf;

/// Locate the vendored tree-sitter-java grammar and compile its `parser.c`.
///
/// Resolution order:
///   1. `JAVA_GRAMMAR` env var, if set (points at the grammar's `src` dir)
///   2. `<repo>/grammars/java/src`, resolved relative to `CARGO_MANIFEST_DIR`
///      (this crate lives in `<repo>/tests/harness`)
fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR");
    let default = PathBuf::from(manifest_dir)
        .join("../..")
        .join("grammars")
        .join("java")
        .join("src");
    let src =
        std::env::var("JAVA_GRAMMAR").unwrap_or_else(|_| default.to_string_lossy().into_owned());
    let parser_c = PathBuf::from(&src).join("parser.c");

    if !parser_c.is_file() {
        panic!(
            "harness: Java grammar not found at {}\n\n\
             The grammar is downloaded by Zed on first load and is gitignored, so it is \
             missing in fresh checkouts. Fix by either:\n\
             - opening this extension once in Zed (it downloads the grammar into grammars/java/), or\n\
             - checking out tree-sitter-java at the rev pinned in extension.toml \
             ([grammars.java] rev) into grammars/java/, or\n\
             - pointing the JAVA_GRAMMAR env var at a grammar checkout's src dir.",
            parser_c.display()
        );
    }

    cc::Build::new()
        .include(&src)
        .file(&parser_c)
        .compile("tree-sitter-java");
    println!("cargo:rerun-if-changed={}", parser_c.display());
    println!("cargo:rerun-if-env-changed=JAVA_GRAMMAR");
}
