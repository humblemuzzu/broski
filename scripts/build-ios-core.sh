#!/usr/bin/env bash
# Builds what apps/ios/BroskiCore and apps/ios/BroskiPush need from the Rust crates: each package's
# XCFramework (static library for iOS devices, the iOS simulator and the host Mac, with its C
# headers and module) and generated Swift bindings. Both are build outputs, rewritten on every run.
#
# Usage: scripts/build-ios-core.sh
# Needs macOS with Xcode and the Rust targets aarch64-apple-ios, aarch64-apple-ios-sim, x86_64-apple-ios.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/lib/broski-core.sh"

DEVICE_TARGET=aarch64-apple-ios
# A build for "any iOS Simulator" compiles arm64 and x86_64 alike, so the simulator library holds both.
SIMULATOR_TARGETS=(aarch64-apple-ios-sim x86_64-apple-ios)

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Packages one UniFFI crate into its Swift package: $1 package dir, $2 Swift module name,
# $3 static library basename (without lib/.a), $4 host cdylib path, $5 bindgen config path.
package_swift_crate() {
  local package=$1 module=$2 lib=$3 host_lib=$4 config=$5
  local ffi="${module}FFI"
  local xcframework="$package/$ffi.xcframework"
  local generated="$package/Sources/$module/Generated"
  local stage="$WORK/$module"

  mkdir -p "$stage/simulator"
  local simulator_slices=()
  for target in "${SIMULATOR_TARGETS[@]}"; do
    simulator_slices+=("$(core_output "$target")/lib$lib.a")
  done
  lipo -create "${simulator_slices[@]}" -output "$stage/simulator/lib$lib.a"

  echo "==> Generating the Swift bindings for $module"
  generate_bindings "$host_lib" swift "$stage/bindings" "$config"

  # Swift compiles every generated file into one module, so every crate's header goes into one C
  # module, and this script writes its modulemap (bindgen.toml turns UniFFI's per-crate ones off). It
  # leaves out the `use "Darwin"`, `use "_Builtin_stdbool"` and `use "_Builtin_stdint"` lines of
  # UniFFI's template, which mozilla/uniffi-rs#2917 reports make `canImport(<module>FFI)` false under
  # Xcode 26 and 27; the headers need none of them.
  local headers="$stage/headers"
  local module_headers="$headers/$ffi"
  mkdir -p "$module_headers"
  cp "$stage"/bindings/*.h "$module_headers/"
  {
    echo "module $ffi {"
    for header in "$module_headers"/*.h; do
      echo "    header \"$(basename "$header")\""
    done
    echo "    export *"
    echo "}"
  } >"$module_headers/module.modulemap"

  echo "==> Creating $(basename "$xcframework")"
  local arguments=()
  for library in \
    "$(core_output "$HOST_TARGET")/lib$lib.a" \
    "$(core_output "$DEVICE_TARGET")/lib$lib.a" \
    "$stage/simulator/lib$lib.a"; do
    arguments+=(-library "$library" -headers "$headers")
  done
  rm -rf "$xcframework"
  xcodebuild -create-xcframework "${arguments[@]}" -output "$xcframework"

  rm -rf "$generated"
  mkdir -p "$generated"
  cp "$stage"/bindings/*.swift "$generated/"

  echo "==> Done: $xcframework and $generated"
}

echo "==> Building broski-mobile and broski-push-mobile for $HOST_TARGET, $DEVICE_TARGET and ${SIMULATOR_TARGETS[*]}"
for target in "$HOST_TARGET" "$DEVICE_TARGET" "${SIMULATOR_TARGETS[@]}"; do
  build_core "$target"
  build_push "$target"
done

package_swift_crate "$ROOT/apps/ios/BroskiCore" BroskiCore broski_core "$(host_core_library)" mobile/bindgen.toml
package_swift_crate "$ROOT/apps/ios/BroskiPush" BroskiPush broski_push "$(host_push_library)" push-mobile/bindgen.toml
