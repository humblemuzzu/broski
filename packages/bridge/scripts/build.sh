#!/bin/sh
set -e

# ──────────────────────────────────────────────
# Broski Bridge — Native Binary Build Script
# ──────────────────────────────────────────────
# Usage:
#   sh scripts/build.sh              # build all platforms
#   sh scripts/build.sh --target darwin-arm64   # build one platform

ENTRY="./src/index.ts"
DIST="./dist"

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

# Define targets: bun-target → output-name
build_target() {
  BUN_TARGET="$1"
  OUTPUT_NAME="$2"
  PLATFORM="$3"

  echo "  Building ${OUTPUT_NAME} (${BUN_TARGET})..."
  bun build --compile --target="$BUN_TARGET" "$ENTRY" --outfile "${DIST}/${OUTPUT_NAME}"
  echo "    Done."

  # Build native license library (best-effort).
  # Disabled by default because it adds Rust as a build dependency and may require network access.
  # Enable explicitly with: BROSKI_BUILD_NATIVE_LICENSE=1
  if [ "${BROSKI_BUILD_NATIVE_LICENSE:-0}" != "1" ]; then
    echo "  Skipping native license library build (set BROSKI_BUILD_NATIVE_LICENSE=1 to enable)"
    return 0
  fi

  # Only build for host target by default.
  HOST_TRIPLE=""
  if command -v rustc >/dev/null 2>&1; then
    HOST_TRIPLE=$(rustc -vV 2>/dev/null | grep '^host:' | awk '{print $2}')
  fi
  RUST_TARGET=""
  LIB_NAME=""
  case "$PLATFORM" in
    darwin-arm64)
      RUST_TARGET="aarch64-apple-darwin"
      LIB_NAME="libbroski_license.dylib"
      ;;
    darwin-x64)
      RUST_TARGET="x86_64-apple-darwin"
      LIB_NAME="libbroski_license.dylib"
      ;;
    linux-x64)
      RUST_TARGET="x86_64-unknown-linux-gnu"
      LIB_NAME="libbroski_license.so"
      ;;
    linux-arm64)
      RUST_TARGET="aarch64-unknown-linux-gnu"
      LIB_NAME="libbroski_license.so"
      ;;
    windows-x64)
      RUST_TARGET="x86_64-pc-windows-msvc"
      LIB_NAME="broski_license.dll"
      ;;
  esac

  if [ -n "$RUST_TARGET" ] && [ -n "$HOST_TRIPLE" ] && [ "$RUST_TARGET" = "$HOST_TRIPLE" ] && command -v cargo >/dev/null 2>&1; then
    echo "  Building native license library (${RUST_TARGET})..."
    (cd native/license && cargo build --release --target "$RUST_TARGET") || echo "    Warning: native license build failed; continuing without it."
    SRC_PATH="native/license/target/${RUST_TARGET}/release/${LIB_NAME}"
    if [ -f "$SRC_PATH" ]; then
      cp "$SRC_PATH" "${DIST}/${LIB_NAME}"
      echo "    Native lib copied: ${DIST}/${LIB_NAME}"
    else
      echo "    Warning: native lib not found at ${SRC_PATH}"
    fi
  else
    echo "  Skipping native license library build for ${PLATFORM} (host=${HOST_TRIPLE})"
  fi
}

TARGETS="
darwin-arm64:broski-darwin-arm64
darwin-x64:broski-darwin-x64
linux-x64:broski-linux-x64
linux-arm64:broski-linux-arm64
windows-x64:broski-windows-x64.exe
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
  echo "  Valid targets: darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64"
  exit 1
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
