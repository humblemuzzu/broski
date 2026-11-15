#!/usr/bin/env bash
# Builds what the apps/android :terminal module needs: libbroski_terminal.so for arm64-v8a and x86_64
# in src/main/jniLibs (the JNI shim of src/main/c linked with libghostty-vt by the NDK's clang), and
# the same for the host in src/test/native, which the JVM tests load. Both are build outputs.
#
# Usage: scripts/build-android-terminal.sh
# Needs curl, tar with xz, JAVA_HOME (the host shim's jni.h) and the NDK of
# apps/android/gradle/libs.versions.toml under ANDROID_HOME. Zig and the libghostty-vt release are
# downloaded once, checked against the pinned SHA-256 sums, into BROSKI_CACHE (~/.cache/broski); each
# libghostty-vt build is kept there too, so a second run only relinks the shim.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/lib/broski-core.sh"

ZIG_VERSION=0.17.1
GHOSTTY_VT_VERSION=1.0.1
GHOSTTY_VT_SHA256=333dfce97641ef9b536bb9e08907ad86abaaada50e8f7417b70d9284adef37aa
GHOSTTY_VT_DEPS_SHA256=91a4e10960a52bf5bf4b15aa2a2cddaff8a89d6cd903d3055bda4fd17de3356d

MODULE="$ROOT/apps/android/terminal"
CACHE="${BROSKI_CACHE:-$HOME/.cache/broski}"
MIN_SDK="$(catalog_version android-minSdk)"
NDK="$(android_ndk_home)"
NDK_BIN="$(echo "$NDK"/toolchains/llvm/prebuilt/*/bin)"
: "${JAVA_HOME:?set JAVA_HOME to a JDK 17}"

case "$(uname -sm)" in
  "Darwin arm64") ZIG_HOST=aarch64-macos ZIG_SHA256=75f1bc7a1e9852f17ec9a0c1895f767c4ec56d46bc8a834920eece1d0359dd8d ;;
  "Darwin x86_64") ZIG_HOST=x86_64-macos ZIG_SHA256=9af07b20319fbd0c92ee46ad23e81d6a782b1aaea2cfb8dcbff35f1d2c7ddbb7 ;;
  "Linux x86_64") ZIG_HOST=x86_64-linux ZIG_SHA256=3581863e3cbcfd0fce0efc682ce7e9e93da96668a977791d356a26d2a7e9b17a ;;
  "Linux aarch64") ZIG_HOST=aarch64-linux ZIG_SHA256=a1546d5646eb184437918d6635ca6b762a0e889eac09cef720ee7a1ed3fe7795 ;;
  *) echo "error: no pinned Zig for $(uname -sm)" >&2; exit 1 ;;
esac

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1
}

# Downloads $1 into the cache as $2 unless it is there, and fails unless its SHA-256 is $3.
fetch() {
  local url=$1 file="$CACHE/downloads/$2" sum=$3
  if [[ ! -f $file ]]; then
    mkdir -p "$CACHE/downloads"
    curl --fail --location --silent --show-error --output "$file.part" "$url"
    mv "$file.part" "$file"
  fi
  if [[ "$(sha256 "$file")" != "$sum" ]]; then
    echo "error: $file does not match its pinned SHA-256 $sum; delete it to download again" >&2
    exit 1
  fi
}

# Unpacks the archive $1 into the cache directory $2 once.
unpack() {
  if [[ ! -d "$CACHE/$2" ]]; then
    mkdir -p "$CACHE/$2.part"
    tar -xf "$CACHE/downloads/$1" -C "$CACHE/$2.part" --strip-components 1
    mv "$CACHE/$2.part" "$CACHE/$2"
  fi
}

fetch "https://ziglang.org/download/$ZIG_VERSION/zig-$ZIG_HOST-$ZIG_VERSION.tar.xz" \
  "zig-$ZIG_HOST-$ZIG_VERSION.tar.xz" "$ZIG_SHA256"
fetch "https://release.files.ghostty.org/libghostty-vt/$GHOSTTY_VT_VERSION/libghostty-vt-$GHOSTTY_VT_VERSION.tar.gz" \
  "libghostty-vt-$GHOSTTY_VT_VERSION.tar.gz" "$GHOSTTY_VT_SHA256"
fetch "https://release.files.ghostty.org/libghostty-vt/$GHOSTTY_VT_VERSION/libghostty-vt-$GHOSTTY_VT_VERSION-deps.tar.gz" \
  "libghostty-vt-$GHOSTTY_VT_VERSION-deps.tar.gz" "$GHOSTTY_VT_DEPS_SHA256"
unpack "zig-$ZIG_HOST-$ZIG_VERSION.tar.xz" "zig-$ZIG_VERSION"
unpack "libghostty-vt-$GHOSTTY_VT_VERSION.tar.gz" "libghostty-vt-$GHOSTTY_VT_VERSION"
unpack "libghostty-vt-$GHOSTTY_VT_VERSION-deps.tar.gz" "libghostty-vt-$GHOSTTY_VT_VERSION-deps"
ZIG="$CACHE/zig-$ZIG_VERSION/zig"
SOURCE="$CACHE/libghostty-vt-$GHOSTTY_VT_VERSION"

# Builds the static libghostty-vt for the Zig target $1 ("host" for this machine) into the cache
# once, offline from the deps tarball, with a fresh Zig cache as PACKAGING-LIBGHOSTTY.md asks; prints
# its install prefix.
ghostty_vt() {
  local target=$1 prefix="$CACHE/ghostty-vt-$GHOSTTY_VT_VERSION-build/$1"
  local target_option=("-Dtarget=$target")
  [[ $target == host ]] && target_option=()
  if [[ ! -f "$prefix/lib/libghostty-vt.a" ]]; then
    echo "==> Building libghostty-vt $GHOSTTY_VT_VERSION for $target" >&2
    local zig_cache
    zig_cache="$(mktemp -d)"
    (cd "$SOURCE" && ANDROID_NDK_HOME="$NDK" ZIG_GLOBAL_CACHE_DIR="$zig_cache" "$ZIG" build \
      --prefix "$prefix.part" --system "$SOURCE-deps" \
      -Doptimize=ReleaseFast -Dcpu=baseline -Dstrip=true ${target_option[@]+"${target_option[@]}"}) >&2
    rm -rf "$zig_cache" "$prefix"
    mv "$prefix.part" "$prefix"
  fi
  echo "$prefix"
}

SHIM=("$MODULE/src/main/c/broski_terminal.c" "$MODULE/src/main/c/broski_terminal_input.c")

rm -rf "$MODULE/src/main/jniLibs"
for abi in arm64-v8a x86_64; do
  case $abi in
    arm64-v8a) triple=aarch64-linux-android ;;
    x86_64) triple=x86_64-linux-android ;;
  esac
  prefix="$(ghostty_vt "$triple.$MIN_SDK")"
  echo "==> Linking libbroski_terminal.so for $abi (API $MIN_SDK)"
  mkdir -p "$MODULE/src/main/jniLibs/$abi"
  "$NDK_BIN/clang" --target="$triple$MIN_SDK" -std=c11 -O2 -fPIC -shared -Wall -Wextra -Werror \
    -I"$prefix/include" "${SHIM[@]}" "$prefix/lib/libghostty-vt.a" \
    -Wl,-z,max-page-size=16384 -Wl,--gc-sections -Wl,--no-undefined -Wl,-s -lm \
    -o "$MODULE/src/main/jniLibs/$abi/libbroski_terminal.so"
done

prefix="$(ghostty_vt host)"
case "$(uname -s)" in
  Darwin) host_library=libbroski_terminal.dylib jni_os=darwin ;;
  *) host_library=libbroski_terminal.so jni_os=linux ;;
esac
echo "==> Linking $host_library for the JVM tests"
rm -rf "$MODULE/src/test/native"
mkdir -p "$MODULE/src/test/native"
"$ZIG" cc -std=c11 -O2 -fPIC -shared -Wall -Wextra -Werror \
  -I"$prefix/include" -I"$JAVA_HOME/include" -I"$JAVA_HOME/include/$jni_os" \
  "${SHIM[@]}" "$prefix/lib/libghostty-vt.a" -lm -o "$MODULE/src/test/native/$host_library"

echo "==> Done: $MODULE/src/main/jniLibs and src/test/native"
