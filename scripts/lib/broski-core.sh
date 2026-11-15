# Shared by build-ios-core.sh and build-android-core.sh, which source it after setting ROOT.

LINK_DIR="$ROOT/packages/link"
CORE_PROFILE=mobile
CORE_TARGET_DIR="$LINK_DIR/target"
# The minimums of apps/ios/BroskiCore/Package.swift, so the core's C code (ring) is built for them
# rather than for the SDK's own version. Both scripts set them, so neither rebuilds the other's host
# library.
export IPHONEOS_DEPLOYMENT_TARGET=26.0 MACOSX_DEPLOYMENT_TARGET=15.0

# Builds broski-mobile with the shipping profile for the given cargo target, or the host if none.
build_core() {
  (cd "$LINK_DIR" && cargo build --locked -p broski-mobile --profile "$CORE_PROFILE" ${1:+--target "$1"})
}

# The host's cdylib of the last build_core without a target: what bindgen reads in library mode and
# what the host-side tests load.
host_core_library() {
  case "$(uname -s)" in
    Darwin) echo "$CORE_TARGET_DIR/$CORE_PROFILE/libbroski_core.dylib" ;;
    *) echo "$CORE_TARGET_DIR/$CORE_PROFILE/libbroski_core.so" ;;
  esac
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
