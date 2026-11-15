#!/bin/sh
set -e

# ──────────────────────────────────────────────
# Broski Bridge — Native Binary Build Script
# ──────────────────────────────────────────────
# Usage:
#   sh scripts/build.sh              # build all platforms
#   sh scripts/build.sh --target darwin-arm64   # build one platform

ENTRY="./src/bootstrap.ts"
DIST="./dist"
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
LINK_DIR="${SCRIPT_DIR}/../../link"

# Read version from package.json
VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')

echo ""
echo "  Broski Bridge v${VERSION} — Build"
echo "  ================================="
echo ""

# Parse --target flag
TARGET_FILTER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target)
      TARGET_FILTER="$2"
      shift 2
      ;;
    --target=*)
      TARGET_FILTER="${1#*=}"
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Clean dist/
rm -rf "$DIST"
mkdir -p "$DIST"

detect_host_platform() {
  HOST_OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  HOST_ARCH_RAW=$(uname -m)
  HOST_ARCH=""

  case "$HOST_ARCH_RAW" in
    arm64|aarch64)
      HOST_ARCH="arm64"
      ;;
    x86_64|amd64)
      HOST_ARCH="x64"
      ;;
    *)
      HOST_ARCH="$HOST_ARCH_RAW"
      ;;
  esac

  case "$HOST_OS" in
    darwin*) echo "darwin-${HOST_ARCH}" ;;
    linux*) echo "linux-${HOST_ARCH}" ;;
    mingw*|msys*|cygwin*) echo "windows-${HOST_ARCH}" ;;
    *) echo "${HOST_OS}-${HOST_ARCH}" ;;
  esac
}

HOST_PLATFORM=$(detect_host_platform)

build_pty_helper() {
  PLATFORM="$1"
  PTY_SRC="native/pty/pty_helper.c"

  if [ ! -f "$PTY_SRC" ]; then
    echo "  Native PTY helper source not found; skipping"
    return 0
  fi

  if [ "$PLATFORM" != "$HOST_PLATFORM" ]; then
    echo "  Skipping native PTY helper for ${PLATFORM} (host=${HOST_PLATFORM})"
    return 0
  fi

  echo "  Building native PTY helper (${PLATFORM})..."

  case "$PLATFORM" in
    darwin-*)
      OUTPUT="${DIST}/libbroski_pty.dylib"
      if cc -dynamiclib -o "$OUTPUT" "$PTY_SRC" 2>/dev/null; then
        echo "    ✓ Built libbroski_pty.dylib"
      else
        echo "    ⚠ Failed to build libbroski_pty.dylib"
      fi
      ;;
    linux-*)
      OUTPUT="${DIST}/libbroski_pty.so"
      if cc -shared -fPIC -o "$OUTPUT" "$PTY_SRC" -lutil 2>/dev/null; then
        echo "    ✓ Built libbroski_pty.so"
      else
        echo "    ⚠ Failed to build libbroski_pty.so"
      fi
      ;;
    *)
      echo "  Native PTY helper not supported on ${PLATFORM}"
      ;;
  esac
}

COMPILED_ENTRY="./src/_bootstrap_embedded.ts"

# Define targets: bun-target → output-name
build_target() {
  BUN_TARGET="$1"
  OUTPUT_NAME="$2"
  PLATFORM="$3"

  # ── Step 1: Build native PTY FIRST (so we can embed it) ──
  build_pty_helper "$PLATFORM"

  # ── Step 2: Generate the compiled entry: bootstrap.ts with, when built, the PTY dylib inlined ──
  # On first run the binary extracts the dylib next to itself. No extra files needed.
  PTY_HASH_DEFINE=""
  PTY_B64="%%EMBEDDED_PTY_LIB_BASE64_PLACEHOLDER%%"
  case "$PLATFORM" in
    darwin-*) PTY_EMBED_LIB="${DIST}/libbroski_pty.dylib" ;;
    linux-*)  PTY_EMBED_LIB="${DIST}/libbroski_pty.so" ;;
    *)        PTY_EMBED_LIB="" ;;
  esac

  if [ -n "$PTY_EMBED_LIB" ] && [ -f "$PTY_EMBED_LIB" ]; then
    PTY_B64=$(base64 < "$PTY_EMBED_LIB" | tr -d '\n')
    PTY_SHA=$(shasum -a 256 "$PTY_EMBED_LIB" | awk '{print $1}')
    PTY_HASH_DEFINE="BROSKI_PTY_LIB_HASH=\"${PTY_SHA}\""
    echo "    ✓ PTY library embedded ($(wc -c < "$PTY_EMBED_LIB" | tr -d ' ') bytes), sha256 ${PTY_SHA}"
  else
    echo "    - No PTY library to embed"
  fi
  # Keep the generated files in src/ so relative imports (./index) resolve correctly
  sed -e "s|%%EMBEDDED_PTY_LIB_BASE64_PLACEHOLDER%%|${PTY_B64}|" "$ENTRY" > "$COMPILED_ENTRY"

  # ── Step 3: Compile the binary ──
  # --bytecode caches the whole module graph as bytecode (~3x faster startup,
  # +25MB); it flips the default output format to cjs, so --format=esm is
  # required for the entry's top-level await.
  # --define bakes the PTY sidecar's sha256 into native-pty.ts, which then
  # refuses to dlopen a library whose bytes do not match.
  echo "  Building ${OUTPUT_NAME} (${BUN_TARGET})..."
  if [ -n "$PTY_HASH_DEFINE" ]; then
    bun build --compile --bytecode --format=esm --target="$BUN_TARGET" --define "$PTY_HASH_DEFINE" "$COMPILED_ENTRY" --outfile "${DIST}/${OUTPUT_NAME}"
  else
    bun build --compile --bytecode --format=esm --target="$BUN_TARGET" "$COMPILED_ENTRY" --outfile "${DIST}/${OUTPUT_NAME}"
  fi
  echo "    Done."

  # Clean up the generated entry
  rm -f "$COMPILED_ENTRY" 2>/dev/null
}

TARGETS="
darwin-arm64:broski-darwin-arm64
darwin-x64:broski-darwin-x64
linux-x64:broski-linux-x64
linux-arm64:broski-linux-arm64
"

BUILT=0

for pair in $TARGETS; do
  PLATFORM=$(echo "$pair" | cut -d: -f1)
  OUTPUT=$(echo "$pair" | cut -d: -f2)
  BUN_TARGET="bun-${PLATFORM}"

  # If --target was specified, skip non-matching platforms
  if [ -n "$TARGET_FILTER" ] && [ "$PLATFORM" != "$TARGET_FILTER" ]; then
    continue
  fi

  build_target "$BUN_TARGET" "$OUTPUT" "$PLATFORM"
  BUILT=$((BUILT + 1))
done

if [ "$BUILT" -eq 0 ]; then
  echo "  Error: No targets matched '${TARGET_FILTER}'"
  echo "  Valid targets: darwin-arm64, darwin-x64, linux-x64, linux-arm64"
  exit 1
fi

# ──────────────────────────────────────────────
# broski-link (Rust daemon that supervises the bridge)
# ──────────────────────────────────────────────
# Built for the host target always, and for the other unix targets when their
# Rust target is already installed. Toolchains are never installed from here.

LINK_TARGETS="
darwin-arm64:aarch64-apple-darwin
darwin-x64:x86_64-apple-darwin
linux-x64:x86_64-unknown-linux-gnu
linux-arm64:aarch64-unknown-linux-gnu
"

rustup_has_target() {
  command -v rustup >/dev/null 2>&1 || return 1
  rustup target list --installed 2>/dev/null | grep -qx "$1"
}

build_link_target() {
  LINK_PLATFORM="$1"
  TRIPLE="$2"
  OUTPUT="${DIST}/broski-link-${LINK_PLATFORM}"

  if [ "$LINK_PLATFORM" = "$HOST_PLATFORM" ]; then
    echo "  Building broski-link-${LINK_PLATFORM} (native)..."
    ( cd "$LINK_DIR" && cargo build --release -p broski-link-daemon --bin broski-link )
    cp "${LINK_DIR}/target/release/broski-link" "$OUTPUT"
    echo "    ✓ Built broski-link-${LINK_PLATFORM}"
    return 0
  fi

  if ! rustup_has_target "$TRIPLE"; then
    echo "  Skipping broski-link-${LINK_PLATFORM}: Rust target ${TRIPLE} is not installed"
    echo "    Add it with: rustup target add ${TRIPLE}"
    return 0
  fi

  echo "  Building broski-link-${LINK_PLATFORM} (${TRIPLE})..."
  if ( cd "$LINK_DIR" && cargo build --release -p broski-link-daemon --bin broski-link --target "$TRIPLE" ) &&
    [ -f "${LINK_DIR}/target/${TRIPLE}/release/broski-link" ]; then
    cp "${LINK_DIR}/target/${TRIPLE}/release/broski-link" "$OUTPUT"
    echo "    ✓ Built broski-link-${LINK_PLATFORM}"
  else
    echo "    ⚠ Skipping broski-link-${LINK_PLATFORM}: build failed (a ${TRIPLE} linker is missing?)"
  fi
}

if [ ! -f "${LINK_DIR}/Cargo.toml" ]; then
  echo ""
  echo "  broski-link source not found at ${LINK_DIR}; skipping"
elif ! command -v cargo >/dev/null 2>&1; then
  echo ""
  echo "  cargo not found; skipping broski-link (install Rust: https://rustup.rs)"
else
  echo ""
  echo "  broski-link (host: ${HOST_PLATFORM}):"
  for pair in $LINK_TARGETS; do
    LINK_PLATFORM=$(echo "$pair" | cut -d: -f1)
    TRIPLE=$(echo "$pair" | cut -d: -f2)

    if [ -n "$TARGET_FILTER" ] && [ "$LINK_PLATFORM" != "$TARGET_FILTER" ]; then
      continue
    fi

    build_link_target "$LINK_PLATFORM" "$TRIPLE"
  done
fi

# ──────────────────────────────────────────────
# PTY library hashes (informational)
# ──────────────────────────────────────────────

echo ""
echo "  PTY sidecar hashes (embedded in binary):"
for lib in "$DIST"/libbroski_pty.*; do
  [ -f "$lib" ] || continue
  PTY_HASH=$(shasum -a 256 "$lib" | awk '{print $1}')
  echo "    ✓ $(basename "$lib"): ${PTY_HASH}"
done

# ──────────────────────────────────────────────
# macOS ad-hoc codesign
# ──────────────────────────────────────────────
# Ad-hoc signing (codesign -s -) doesn't require an Apple Developer
# certificate. Without it, macOS Gatekeeper kills the binary with "Killed: 9".

echo ""
echo "  Signing macOS binaries..."
for binary in "$DIST"/broski-*darwin*; do
  [ -f "$binary" ] || continue
  case "$binary" in *.dylib|*.so|*.dll) continue ;; esac

  if command -v codesign >/dev/null 2>&1; then
    codesign -f -s - "$binary" 2>/dev/null
    echo "    ✓ $(basename "$binary"): ad-hoc signed"
  else
    echo "    ⚠ $(basename "$binary"): codesign not available (not on macOS?)"
  fi
done

# ──────────────────────────────────────────────
# SHA256SUMS (release artifact verification)
# ──────────────────────────────────────────────
# Generated after signing: codesign rewrites the binary, so hashes taken
# before it would not match the published files.

echo ""
if command -v sha256sum >/dev/null 2>&1; then
  HASH_TOOL="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  HASH_TOOL="shasum -a 256"
else
  HASH_TOOL=""
fi

if [ -z "$HASH_TOOL" ]; then
  echo "  ⚠ Neither sha256sum nor shasum found; skipping SHA256SUMS"
else
  : > "${DIST}/SHA256SUMS"
  for artifact in "$DIST"/broski-* "$DIST"/libbroski_pty.*; do
    [ -f "$artifact" ] || continue
    ( cd "$DIST" && $HASH_TOOL "$(basename "$artifact")" ) >> "${DIST}/SHA256SUMS"
  done
  echo "  Checksums (${DIST}/SHA256SUMS):"
  while read -r sums_line; do
    echo "    $sums_line"
  done < "${DIST}/SHA256SUMS"
fi

# Print file sizes
echo ""
echo "  Build output (${DIST}/):"
echo "  ────────────────────────────────────"
ls -lh "$DIST"/ | tail -n +2 | while read -r line; do
  echo "    $line"
done
echo ""
echo "  Build complete. ${BUILT} binary(ies) built."
echo ""
