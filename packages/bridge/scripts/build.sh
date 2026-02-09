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

# Define targets: bun-target → output-name
build_target() {
  BUN_TARGET="$1"
  OUTPUT_NAME="$2"
  PLATFORM="$3"

  echo "  Building ${OUTPUT_NAME} (${BUN_TARGET})..."
  bun build --compile --target="$BUN_TARGET" "$ENTRY" --outfile "${DIST}/${OUTPUT_NAME}"
  echo "    Done."

  build_pty_helper "$PLATFORM"

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

# ──────────────────────────────────────────────
# Compute security sentinel (integrity check hash)
# ──────────────────────────────────────────────
echo "  Computing security sentinel..."
SENTINEL=$(node -e "
const crypto = require('crypto');
const values = [
  'MCowBQYDK2VwAyEARXrmjPy-wNpwAzbarnZIQc9hvmOFrVLv5dTuGK2j-eM',
  'BRSK-LICENSE',
  '.convex.site',
  'EdDSA',
  'v1',
];
process.stdout.write(crypto.createHash('sha256').update(values.join('\x00')).digest('hex'));
")
echo "  Sentinel: ${SENTINEL}"

# Verify the sentinel matches what's hardcoded in integrity.ts
# (catches dev mistakes where someone updates a value but forgets to update the hash)
# Extract only the hex chunk lines (they're the lines with just hex strings in single quotes)
EXPECTED_IN_CODE=$(sed -n '/EXPECTED_SENTINEL_CHUNKS/,/^\]/p' src/license/integrity.ts \
  | grep -oE "'[0-9a-f]+'" | tr -d "'" | tr -d '\n')
if [ -n "$EXPECTED_IN_CODE" ] && [ "$EXPECTED_IN_CODE" = "$SENTINEL" ]; then
  echo "  ✓ Sentinel matches hardcoded value in integrity.ts"
else
  echo "  ⚠ WARNING: Sentinel mismatch!"
  echo "    Computed: ${SENTINEL}"
  echo "    In code:  ${EXPECTED_IN_CODE}"
  echo "    If you changed security constants, update EXPECTED_SENTINEL_CHUNKS in integrity.ts"
  echo ""
fi
echo ""

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

# ──────────────────────────────────────────────
# Hash native sidecar library (if present)
# ──────────────────────────────────────────────
# ⚠️ ORDER MATTERS: This MUST run BEFORE signing because it modifies the binary.
#
# Bake the SHA-256 of the native .dylib/.so/.dll into each compiled binary.
# This prevents an attacker from swapping the sidecar with a fake one that
# always returns "license valid". Without this, Ghidra users could:
#   1. Write a fake libbroski_license.dylib with verify_jws → always return 1
#   2. Drop it next to the binary
#   3. The binary would load it via FFI and trust it blindly
#
# The hash replaces %%NATIVE_LIB_HASH_PLACEHOLDER%% in the compiled output.

echo ""
echo "  Baking native sidecar hashes..."
for binary in "$DIST"/broski-*; do
  [ -f "$binary" ] || continue
  # Skip .sig files
  case "$binary" in *.sig) continue ;; esac

  # Determine which native lib this binary would load
  case "$binary" in
    *darwin*)  NATIVE_LIB="${DIST}/libbroski_license.dylib" ;;
    *linux*)   NATIVE_LIB="${DIST}/libbroski_license.so" ;;
    *windows*) NATIVE_LIB="${DIST}/broski_license.dll" ;;
    *)         NATIVE_LIB="" ;;
  esac

  if [ -n "$NATIVE_LIB" ] && [ -f "$NATIVE_LIB" ]; then
    NATIVE_HASH=$(shasum -a 256 "$NATIVE_LIB" | awk '{print $1}')
    echo "    ✓ $(basename "$binary"): ${NATIVE_HASH:0:16}..."

    # Replace placeholder in the compiled binary.
    # The placeholder is a fixed-length string so the binary size doesn't change.
    # We use perl for in-place binary-safe replacement.
    perl -pi -e "s/%%NATIVE_LIB_HASH_PLACEHOLDER%%/${NATIVE_HASH}/g" "$binary"
  else
    echo "    - $(basename "$binary"): no native lib (placeholder stays, check skipped at runtime)"
  fi
done

# ──────────────────────────────────────────────
# Hash PTY sidecar library (if present)
# ──────────────────────────────────────────────

echo ""
echo "  Baking PTY sidecar hashes..."
for binary in "$DIST"/broski-*; do
  [ -f "$binary" ] || continue
  case "$binary" in *.sig|*.dylib|*.so|*.dll) continue ;; esac

  case "$binary" in
    *darwin*) PTY_LIB="${DIST}/libbroski_pty.dylib" ;;
    *linux*) PTY_LIB="${DIST}/libbroski_pty.so" ;;
    *) PTY_LIB="" ;;
  esac

  if [ -n "$PTY_LIB" ] && [ -f "$PTY_LIB" ]; then
    PTY_HASH=$(shasum -a 256 "$PTY_LIB" | awk '{print $1}')
    echo "    ✓ $(basename "$binary"): ${PTY_HASH}"
    perl -pi -e "s/%%PTY_LIB_HASH_PLACEHOLDER%%/${PTY_HASH}/g" "$binary"
  else
    echo "    - $(basename "$binary"): no PTY lib (placeholder stays)"
  fi
done

# ──────────────────────────────────────────────
# Sign each binary (create .sig sidecar files)
# ──────────────────────────────────────────────
# ⚠️ ORDER MATTERS: This MUST run AFTER native hash baking (above) and AFTER
# macOS codesign (if applicable) because both modify the binary. The .sig is
# a signature of the FINAL binary.
#
# The .sig file contains an Ed25519 signature of the binary's SHA-256 hash.
# This is the primary tamper-protection on Linux (no OS codesign) and
# defense-in-depth on macOS/Windows.
#
# Requires BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL env var (same key used
# by Convex to sign licenses). In CI, set this as a secret.
# If not set, binaries ship unsigned (sentinel check is still active).

SIGN_KEY="${BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL:-}"
if [ -n "$SIGN_KEY" ]; then
  echo ""
  echo "  Signing binaries..."
  for binary in "$DIST"/broski-*; do
    [ -f "$binary" ] || continue
    # Skip .sig files and native libs
    case "$binary" in *.sig|*.dylib|*.so|*.dll) continue ;; esac
    SIG_FILE="${binary}.sig"
    # Compute SHA-256 → sign with Ed25519 → base64url
    node -e "
      const crypto = require('crypto');
      const fs = require('fs');
      const privDerB64 = process.env.BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL;
      const privDer = Buffer.from(privDerB64, 'base64url');
      const privKey = crypto.createPrivateKey({ key: privDer, format: 'der', type: 'pkcs8' });
      const binaryData = fs.readFileSync('${binary}');
      const hash = crypto.createHash('sha256').update(binaryData).digest('hex');
      const sig = crypto.sign(null, Buffer.from(hash, 'utf-8'), privKey);
      fs.writeFileSync('${SIG_FILE}', sig.toString('base64url'));
    " 2>/dev/null

    if [ -f "$SIG_FILE" ]; then
      echo "    ✓ Signed: $(basename "$binary") → $(basename "$SIG_FILE")"
    else
      echo "    ✗ Failed to sign: $(basename "$binary")"
    fi
  done
else
  echo ""
  echo "  ⚠ Skipping binary signing (BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL not set)"
  echo "    Set this env var in CI to enable .sig sidecar files."
  echo "    Binaries will still work but without signed hash verification on Linux."
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
