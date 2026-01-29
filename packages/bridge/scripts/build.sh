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

  echo "  Building ${OUTPUT_NAME} (${BUN_TARGET})..."
  bun build --compile --target="$BUN_TARGET" "$ENTRY" --outfile "${DIST}/${OUTPUT_NAME}"
  echo "    Done."
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

  build_target "$BUN_TARGET" "$OUTPUT"
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
