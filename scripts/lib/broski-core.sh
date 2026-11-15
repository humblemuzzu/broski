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

# Builds broski-mobile with the shipping profile for the cargo target $1.
build_core() {
  (cd "$LINK_DIR" && cargo build --locked -p broski-mobile --profile "$CORE_PROFILE" --target "$1")
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

# A value of apps/android/gradle/libs.versions.toml's [versions], e.g. `catalog_version android-ndk`.
catalog_version() {
  sed -n "s/^$1 = \"\(.*\)\"\$/\1/p" "$ROOT/apps/android/gradle/libs.versions.toml"
}

# ANDROID_NDK_HOME, or the catalog's NDK under ANDROID_HOME.
android_ndk_home() {
  echo "${ANDROID_NDK_HOME:-${ANDROID_HOME:?set ANDROID_HOME or ANDROID_NDK_HOME}/ndk/$(catalog_version android-ndk)}"
}

# Replaces $3 with the $2 (swift|kotlin) bindings of every UniFFI crate in the library $1. The
# bindgen runs from the workspace because it reads crate roots with `cargo metadata`.
generate_bindings() {
  local library=$1 language=$2 out=$3
  rm -rf "$out"
  mkdir -p "$out"
  (cd "$LINK_DIR" && cargo run --locked --quiet -p uniffi-bindgen -- generate \
    --language "$language" --no-format --config mobile/bindgen.toml --out-dir "$out" "$library")
}
