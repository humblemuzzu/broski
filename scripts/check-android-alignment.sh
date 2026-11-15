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
# Only the libraries: R8 shortens resource names so far that two differ by case alone, and unzip
# prompts on the collision on a case-insensitive disk. An APK keeps them in lib/, an AAR in jni/;
# unzip exits 11 when nothing matches, which the check below reports.
native=lib
[[ $ARCHIVE == *.aar ]] && native=jni
unzip -q "$ARCHIVE" "$native/*/*.so" -d "$WORK" || [[ $? == 11 ]]

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
