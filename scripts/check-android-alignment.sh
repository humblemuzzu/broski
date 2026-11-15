#!/usr/bin/env bash
# Fails unless every native library in an AAR or APK maps with 16 KB-aligned LOAD segments, which
# devices with 16 KB pages need and Google Play requires.
#
# Usage: scripts/check-android-alignment.sh <file.aar|file.apk>
# Needs the NDK of apps/android/gradle/libs.versions.toml, installed under ANDROID_HOME (ANDROID_NDK_HOME is
# used only when it is not).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/lib/broski-core.sh"

ARCHIVE="${1:?usage: $0 <file.aar|file.apk>}"
READELF="$(echo "$(android_ndk_home)"/toolchains/llvm/prebuilt/*/bin/llvm-readelf)"
PAGE=0x4000

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
unzip -q "$ARCHIVE" -d "$WORK"

libraries=()
while IFS= read -r library; do
  libraries+=("$library")
done < <(find "$WORK" -name '*.so' | sort)
if ((${#libraries[@]} == 0)); then
  echo "error: no native library in $ARCHIVE" >&2
  exit 1
fi

failed=0
for library in "${libraries[@]}"; do
  aligns="$("$READELF" -lW "$library" | awk '$1 == "LOAD" { print $NF }' | sort -u | tr '\n' ' ')"
  verdict=ok
  for align in $aligns; do
    if ((align < PAGE)); then
      verdict=FAIL
      failed=1
    fi
  done
  echo "$verdict ${library#"$WORK"/}: LOAD alignment $aligns"
done
exit "$failed"
