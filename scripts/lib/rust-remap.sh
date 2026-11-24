# shellcheck shell=sh
# Sourced by every script that builds Rust that ships (POSIX sh, so packages/bridge/scripts/build.sh
# can use it too). rustc writes source paths into panic messages, and without this a binary built
# here names this machine's home directory in every dependency path.

# Adds to RUSTFLAGS (and CFLAGS) the remaps for the toolchain, the registry and the checkout at $1.
broski_rust_remap() {
  broski_link_dir=$(cd "$1" && pwd -P)
  broski_cargo_home=${CARGO_HOME:-$HOME/.cargo}
  broski_rustup_home=${RUSTUP_HOME:-$HOME/.rustup}
  # rustc applies the last prefix that matches, so the home directory, the most general, goes first.
  broski_remap="--remap-path-prefix=$HOME=/home"
  broski_remap="$broski_remap --remap-path-prefix=$broski_rustup_home=/rustup"
  broski_remap="$broski_remap --remap-path-prefix=$broski_cargo_home=/cargo"
  broski_remap="$broski_remap --remap-path-prefix=$broski_link_dir=/broski/packages/link"
  RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }$broski_remap"
  # The C the crates compile (render's highlighter, through the cc crate) puts __FILE__ in its asserts.
  broski_cmap="-ffile-prefix-map=$HOME=/home -ffile-prefix-map=$broski_link_dir=/broski/packages/link"
  CFLAGS="${CFLAGS:+$CFLAGS }$broski_cmap"
  export RUSTFLAGS CFLAGS
}
