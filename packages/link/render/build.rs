//! Compiles the vendored `@pierre/highlights` C output (generated from WebAssembly by
//! `scripts/generate-highlights.sh`) and its wasm2c runtime into a static archive linked into
//! `broski-render`.

use std::path::PathBuf;

fn main() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let vendor = root.join("vendor/highlights");
    let bridge = root.join("src/highlight/bridge.c");
    let sources = [
        bridge,
        vendor.join("highlights.c"),
        vendor.join("wasm2c/wasm-rt-impl.c"),
        vendor.join("wasm2c/wasm-rt-mem-impl.c"),
    ];
    for path in &sources {
        println!("cargo:rerun-if-changed={}", path.display());
    }
    println!(
        "cargo:rerun-if-changed={}",
        vendor.join("highlights.h").display()
    );

    let mut build = cc::Build::new();
    build
        .files(&sources)
        .include(&vendor)
        .include(vendor.join("wasm2c"))
        .include(vendor.join("simde"))
        // Plain malloc + explicit bounds checks: no guard-page signal handlers fighting mobile
        // crash reporters or ART's signal handlers on Android.
        .define("WASM_RT_USE_MMAP", "0")
        .define("WASM_RT_MEMCHECK_BOUNDS_CHECK", "1")
        .define("WASM_RT_SKIP_SIGNAL_RECOVERY", "1")
        .opt_level(2)
        .warnings(false);
    build.compile("broski_highlights");
}
