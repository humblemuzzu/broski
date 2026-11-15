#!/usr/bin/env bash
# Builds what the apps/android :core module needs from the Rust core: libbroski_core.so for arm64-v8a
# and x86_64 in src/main/jniLibs, the Kotlin bindings in src/generated/kotlin, and the host library
# the JVM unit tests load from src/test/native. All three are build outputs, rewritten on every run.
#
# Usage: scripts/build-android-core.sh
# Needs cargo-ndk 4, the Rust targets aarch64-linux-android and x86_64-linux-android, and the NDK of
# apps/android/gradle/libs.versions.toml, installed under ANDROID_HOME (ANDROID_NDK_HOME is used only when
# it is not).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/lib/broski-core.sh"

MODULE="$ROOT/apps/android/core"
MIN_SDK="$(catalog_version android-minSdk)"
ANDROID_NDK_HOME="$(android_ndk_home)"
# cargo-ndk takes the first of these it finds and warns when another differs, as a runner's presets do.
export ANDROID_NDK_HOME ANDROID_NDK_ROOT="$ANDROID_NDK_HOME"

echo "==> Building the core for arm64-v8a and x86_64 (API $MIN_SDK) with $ANDROID_NDK_HOME"
rm -rf "$MODULE/src/main/jniLibs"
(cd "$LINK_DIR" && cargo ndk --platform "$MIN_SDK" -t arm64-v8a -t x86_64 \
  -o "$MODULE/src/main/jniLibs" build --locked -p broski-mobile --profile "$CORE_PROFILE")

echo "==> Building the core for $HOST_TARGET"
build_core "$HOST_TARGET"

echo "==> Generating the Kotlin bindings"
generate_bindings "$(host_core_library)" kotlin "$MODULE/src/generated/kotlin"

rm -rf "$MODULE/src/test/native"
mkdir -p "$MODULE/src/test/native"
cp "$(host_core_library)" "$MODULE/src/test/native/"

echo "==> Done: $MODULE/src/main/jniLibs, src/generated/kotlin and src/test/native"
