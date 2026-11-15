//! Compiles the vendored grammars in `syntaxes/` into one syntect dump the library embeds, so the
//! apps carry only the languages listed there (syntaxes/README.md) rather than a whole editor's set.

use std::env;
use std::path::PathBuf;

use syntect::parsing::SyntaxSetBuilder;

fn main() {
    let grammars = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("syntaxes");
    println!("cargo:rerun-if-changed={}", grammars.display());
    let mut builder = SyntaxSetBuilder::new();
    builder.add_plain_text_syntax();
    builder
        .add_from_folder(&grammars, true)
        .unwrap_or_else(|error| panic!("the grammars in {} load: {error}", grammars.display()));
    let syntaxes = builder.build();
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("cargo sets OUT_DIR"))
        .join("syntaxes.packdump");
    syntect::dumps::dump_to_file(&syntaxes, &out).unwrap_or_else(|error| {
        panic!("the grammar dump is written to {}: {error}", out.display())
    });
}
