#!/usr/bin/env bash
# Builds what apps/ios/BroskiCore needs from the Rust core: BroskiCoreFFI.xcframework (the static
# library for iOS devices, the iOS simulator and the host Mac, with its C headers and module) and the
# Swift bindings in Sources/BroskiCore/Generated. Both are build outputs, rewritten on every run.
#
# Usage: scripts/build-ios-core.sh
# Needs macOS with Xcode and the Rust targets aarch64-apple-ios, aarch64-apple-ios-sim, x86_64-apple-ios.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/lib/broski-core.sh"

PACKAGE="$ROOT/apps/ios/BroskiCore"
XCFRAMEWORK="$PACKAGE/BroskiCoreFFI.xcframework"
GENERATED="$PACKAGE/Sources/BroskiCore/Generated"
DEVICE_TARGET=aarch64-apple-ios
# A build for "any iOS Simulator" compiles arm64 and x86_64 alike, so the simulator library holds both.
SIMULATOR_TARGETS=(aarch64-apple-ios-sim x86_64-apple-ios)

echo "==> Building the core for the host, $DEVICE_TARGET and ${SIMULATOR_TARGETS[*]}"
build_core
for target in "$DEVICE_TARGET" "${SIMULATOR_TARGETS[@]}"; do
  build_core "$target"
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/simulator"
simulator_slices=()
for target in "${SIMULATOR_TARGETS[@]}"; do
  simulator_slices+=("$CORE_TARGET_DIR/$target/$CORE_PROFILE/libbroski_core.a")
done
lipo -create "${simulator_slices[@]}" -output "$WORK/simulator/libbroski_core.a"

echo "==> Generating the Swift bindings"
generate_bindings "$(host_core_library)" swift "$WORK/bindings"

# Swift compiles every generated file into one module, so every crate's header goes into one C
# module, and this script writes its modulemap (bindgen.toml turns UniFFI's per-crate ones off). It
# leaves out the `use "Darwin"`, `use "_Builtin_stdbool"` and `use "_Builtin_stdint"` lines of
# UniFFI's template, which mozilla/uniffi-rs#2917 reports make `canImport(<module>FFI)` false under
# Xcode 26 and 27; the headers need none of them.
HEADERS="$WORK/headers"
mkdir -p "$HEADERS"
cp "$WORK"/bindings/*.h "$HEADERS/"
{
  echo "module BroskiCoreFFI {"
  for header in "$HEADERS"/*.h; do
    echo "    header \"$(basename "$header")\""
  done
  echo "    export *"
  echo "}"
} >"$HEADERS/module.modulemap"

echo "==> Creating $(basename "$XCFRAMEWORK")"
arguments=()
for library in \
  "$CORE_TARGET_DIR/$CORE_PROFILE/libbroski_core.a" \
  "$CORE_TARGET_DIR/$DEVICE_TARGET/$CORE_PROFILE/libbroski_core.a" \
  "$WORK/simulator/libbroski_core.a"; do
  arguments+=(-library "$library" -headers "$HEADERS")
done
rm -rf "$XCFRAMEWORK"
xcodebuild -create-xcframework "${arguments[@]}" -output "$XCFRAMEWORK"

rm -rf "$GENERATED"
mkdir -p "$GENERATED"
cp "$WORK"/bindings/*.swift "$GENERATED/"

echo "==> Done: $XCFRAMEWORK and $GENERATED"
