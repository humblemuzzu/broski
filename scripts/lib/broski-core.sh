# shellcheck shell=bash
# Shared by the scripts in scripts/, which source it after setting ROOT.

LINK_DIR="$ROOT/packages/link"
CORE_PROFILE=mobile
CORE_TARGET_DIR="$LINK_DIR/target"
HOST_TARGET="$(rustc -vV | sed -n 's/^host: //p')"
# The minimums of apps/ios/BroskiCore/Package.swift, so the core's C code (ring) is built for them
# rather than for the SDK's own version. Both scripts set them, so neither rebuilds the other's host
# library.
export IPHONEOS_DEPLOYMENT_TARGET=26.0 MACOSX_DEPLOYMENT_TARGET=15.0

# True when apps/ios/BroskiCore's or BroskiPush's outputs are missing or older than anything under packages/link.
ios_core_is_stale() {
  local stamp
  for stamp in \
    "$ROOT/apps/ios/BroskiCore/BroskiCoreFFI.xcframework/Info.plist" \
    "$ROOT/apps/ios/BroskiPush/BroskiPushFFI.xcframework/Info.plist"; do
    [[ ! -f $stamp ]] && return 0
    [[ -n $(find "$LINK_DIR" -path '*/target' -prune -o -type f -newer "$stamp" -print -quit) ]] && return 0
  done
  return 1
}

# Builds broski-mobile with the shipping profile for the cargo target $1.
build_core() {
  (cd "$LINK_DIR" && cargo build --locked -p broski-mobile --profile "$CORE_PROFILE" --target "$1")
}

# Builds broski-push-mobile with the shipping profile for the cargo target $1.
build_push() {
  (cd "$LINK_DIR" && cargo build --locked -p broski-push-mobile --profile "$CORE_PROFILE" --target "$1")
}

# Where build_core puts the libraries of target $1.
core_output() {
  echo "$CORE_TARGET_DIR/$1/$CORE_PROFILE"
}

# The host's cdylib (after `build_core "$HOST_TARGET"`): what bindgen reads in library mode and what
# the host-side tests load.
host_core_library() {
  case "$(uname -s)" in
    Darwin) echo "$(core_output "$HOST_TARGET")/libbroski_core.dylib" ;;
    *) echo "$(core_output "$HOST_TARGET")/libbroski_core.so" ;;
  esac
}

host_push_library() {
  case "$(uname -s)" in
    Darwin) echo "$(core_output "$HOST_TARGET")/libbroski_push.dylib" ;;
    *) echo "$(core_output "$HOST_TARGET")/libbroski_push.so" ;;
  esac
}

# A value of apps/android/gradle/libs.versions.toml's [versions], e.g. `catalog_version android-ndk`.
catalog_version() {
  sed -n "s/^$1 = \"\(.*\)\"\$/\1/p" "$ROOT/apps/android/gradle/libs.versions.toml"
}

# The catalog's NDK under ANDROID_HOME when it is installed, else ANDROID_NDK_HOME (with a warning).
# ANDROID_NDK_HOME comes second because a CI runner presets it to the image's own, older NDK, which
# would otherwise win over the one the 16 KB alignment depends on.
android_ndk_home() {
  local pinned="${ANDROID_HOME:+$ANDROID_HOME/ndk/$(catalog_version android-ndk)}"
  if [[ -n $pinned && -d $pinned ]]; then
    echo "$pinned"
  elif [[ -n ${ANDROID_NDK_HOME:-} ]]; then
    echo "warning: NDK $(catalog_version android-ndk) is not installed under \$ANDROID_HOME/ndk; using ANDROID_NDK_HOME" >&2
    echo "$ANDROID_NDK_HOME"
  else
    echo "error: install NDK $(catalog_version android-ndk) under \$ANDROID_HOME/ndk, or set ANDROID_NDK_HOME" >&2
    return 1
  fi
}

# Replaces $3 with the $2 (swift|kotlin) bindings of every UniFFI crate in the library $1, using
# config $4 (default mobile/bindgen.toml).
generate_bindings() {
  local library=$1 language=$2 out=$3 config=${4:-mobile/bindgen.toml}
  rm -rf "$out"
  mkdir -p "$out"
  (cd "$LINK_DIR" && cargo run --locked --quiet -p uniffi-bindgen -- generate \
    --language "$language" --no-format --config "$config" --out-dir "$out" "$library")
}
