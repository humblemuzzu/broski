#!/bin/sh
set -e

# Broski — macOS Bridge & Daemon Installer (GitHub Releases)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/humblemuzzu/broski/main/packages/bridge/scripts/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/humblemuzzu/broski/main/packages/bridge/scripts/install.sh | sh -s -- --install-service
#   sh install.sh --uninstall
#
# Environment overrides:
#   BROSKI_REPO      GitHub owner/repo (default: humblemuzzu/broski)
#   BROSKI_VERSION   Specific release tag, e.g. v0.1.0 (default: latest)
#   BROSKI_BASE_URL  Override download directory (for local release testing)

REPO="${BROSKI_REPO:-humblemuzzu/broski}"
INSTALL_DIR="$HOME/.broski/bin"

if [ -n "${BROSKI_BASE_URL:-}" ]; then
  BASE_URL="${BROSKI_BASE_URL%/}"
elif [ -n "${BROSKI_VERSION:-}" ]; then
  BASE_URL="https://github.com/${REPO}/releases/download/${BROSKI_VERSION}"
else
  BASE_URL="https://github.com/${REPO}/releases/latest/download"
fi

INSTALL_SERVICE=0
UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --install-service) INSTALL_SERVICE=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --help|-h)
      echo "Usage: install.sh [--install-service | --uninstall]"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      exit 1
      ;;
  esac
done

remove_path_block() {
  RC_FILE="$1"
  [ -f "$RC_FILE" ] || return 0
  if grep -q "$INSTALL_DIR" "$RC_FILE" 2>/dev/null; then
    TMP_RC="${RC_FILE}.broski.tmp"
    awk -v dir="$INSTALL_DIR" '
      $0 == "# Broski" { skip = 1; next }
      skip && index($0, dir) > 0 { skip = 0; next }
      { skip = 0; print }
    ' "$RC_FILE" > "$TMP_RC"
    mv "$TMP_RC" "$RC_FILE"
    echo "  ✓ Removed PATH entry from ${RC_FILE}"
  fi
}

if [ "$UNINSTALL" = "1" ]; then
  echo ""
  echo "  Uninstalling Broski..."
  if [ -x "${INSTALL_DIR}/broski" ]; then
    "${INSTALL_DIR}/broski" uninstall >/dev/null 2>&1 || true
  fi
  rm -rf "$INSTALL_DIR"
  remove_path_block "$HOME/.zshrc"
  remove_path_block "$HOME/.bashrc"
  remove_path_block "$HOME/.profile"
  echo "  ✓ Removed ${INSTALL_DIR}"
  echo "  Config and pairings remain in ~/.broski (delete manually if you want a full wipe)."
  echo ""
  exit 0
fi

echo ""
echo "  Installing Broski (macOS)..."
echo ""

OS_RAW=$(uname -s)
case "$OS_RAW" in
  Darwin) OS="darwin" ;;
  *)
    echo "  Error: Unsupported operating system '${OS_RAW}'."
    echo "  Broski's desktop host supports macOS only."
    exit 1
    ;;
esac

ARCH_RAW=$(uname -m)
case "$ARCH_RAW" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64)  ARCH="x64" ;;
  *)
    echo "  Error: Unsupported architecture '${ARCH_RAW}'."
    echo "  Broski supports Apple Silicon (arm64) and Intel (x86_64) Macs."
    exit 1
    ;;
esac

TARGET="${OS}-${ARCH}"
BINARY_NAME="broski-${TARGET}"
LINK_NAME="broski-link-${TARGET}"
PTY_LIB="libbroski_pty.dylib"

echo "  Platform: ${TARGET}"
echo "  Source:   ${BASE_URL}"
echo ""

mkdir -p "$INSTALL_DIR"

sha256_of() {
  shasum -a 256 "$1" | awk '{print $1}'
}

expected_sha256() {
  awk -v file="$1" '$2 == file || $2 == ("*" file) { print $1; exit }' "${INSTALL_DIR}/SHA256SUMS"
}

verify_sha256() {
  FILE="$1"
  NAME="$2"
  EXPECTED=$(expected_sha256 "$NAME")
  if [ -z "$EXPECTED" ]; then
    echo "  Error: ${NAME} is not listed in SHA256SUMS"
    rm -f "$FILE"
    exit 1
  fi
  ACTUAL=$(sha256_of "$FILE")
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "  Error: checksum mismatch for ${NAME}"
    echo "    expected ${EXPECTED}"
    echo "    got      ${ACTUAL}"
    rm -f "$FILE"
    exit 1
  fi
  echo "  ✓ ${NAME} verified"
}

curl_get() {
  curl -fSL --retry 3 --retry-delay 2 --connect-timeout 30 --speed-time 60 --speed-limit 1024 "$1" -o "$2"
}

download_binary() {
  NAME="$1"
  DEST="$2"
  OPTIONAL="${3:-0}"
  if [ -n "$(expected_sha256 "${NAME}.gz")" ] && command -v gzip >/dev/null 2>&1; then
    TMP_GZ="${DEST}.gz.tmp"
    echo "  Downloading ${NAME}.gz..."
    if curl_get "${BASE_URL}/${NAME}.gz" "$TMP_GZ"; then
      verify_sha256 "$TMP_GZ" "${NAME}.gz"
      gzip -dc "$TMP_GZ" > "$DEST"
      rm -f "$TMP_GZ"
      chmod +x "$DEST"
      return 0
    fi
    rm -f "$TMP_GZ"
    [ "$OPTIONAL" = "1" ] && return 1
    exit 1
  fi
  echo "  Downloading ${NAME}..."
  if curl_get "${BASE_URL}/${NAME}" "$DEST"; then
    chmod +x "$DEST"
    verify_sha256 "$DEST" "$NAME"
    return 0
  fi
  rm -f "$DEST" 2>/dev/null
  [ "$OPTIONAL" = "1" ] && return 1
  exit 1
}

echo "  Downloading SHA256SUMS..."
if ! curl_get "${BASE_URL}/SHA256SUMS" "${INSTALL_DIR}/SHA256SUMS"; then
  echo "  Error: could not download ${BASE_URL}/SHA256SUMS"
  echo "  Refusing to install an unverified binary."
  exit 1
fi

download_binary "${BINARY_NAME}" "${INSTALL_DIR}/broski" 0

if ! download_binary "${LINK_NAME}" "${INSTALL_DIR}/broski-link" 1; then
  echo "  ⚠ broski-link is not published for ${TARGET}"
  echo "    Build from source with: cd packages/link && cargo build --release -p broski-link-daemon"
fi

if [ -n "$(expected_sha256 "$PTY_LIB")" ]; then
  if curl_get "${BASE_URL}/${PTY_LIB}" "${INSTALL_DIR}/${PTY_LIB}" 2>/dev/null; then
    verify_sha256 "${INSTALL_DIR}/${PTY_LIB}" "${PTY_LIB}"
  else
    echo "  ⚠ PTY library download failed (terminal sessions disabled)"
    rm -f "${INSTALL_DIR}/${PTY_LIB}" 2>/dev/null
  fi
fi

echo ""

CURRENT_SHELL=$(basename "${SHELL:-/bin/sh}")
PROFILE_FILE=""

case ":$PATH:" in
  *":${INSTALL_DIR}:"*)
    echo "  Already in PATH."
    ;;
  *)
    case "$CURRENT_SHELL" in
      zsh)  PROFILE_FILE="$HOME/.zshrc" ;;
      bash) PROFILE_FILE="$HOME/.bashrc" ;;
      fish)
        fish -c "set -Ux fish_user_paths $INSTALL_DIR \$fish_user_paths" 2>/dev/null || true
        echo "  ✓ Added to PATH (fish)"
        ;;
      *)    PROFILE_FILE="$HOME/.profile" ;;
    esac

    if [ -n "$PROFILE_FILE" ]; then
      if ! grep -q "$INSTALL_DIR" "$PROFILE_FILE" 2>/dev/null; then
        echo "" >> "$PROFILE_FILE"
        echo "# Broski" >> "$PROFILE_FILE"
        echo "export PATH=\"${INSTALL_DIR}:\$PATH\"" >> "$PROFILE_FILE"
      fi
      echo "  ✓ Added to PATH in ${PROFILE_FILE}"
    fi
    ;;
esac

export PATH="${INSTALL_DIR}:$PATH"

if [ "$INSTALL_SERVICE" = "1" ]; then
  echo ""
  echo "  Installing the Broski Link background service..."
  "${INSTALL_DIR}/broski" install
  echo ""
else
  echo ""
  echo "  Run \`broski install\` to keep Broski running as a macOS login service."
  echo ""
fi

INSTALLED_VERSION=$("${INSTALL_DIR}/broski" --version 2>/dev/null | head -1 || echo "installed")
echo "  ✓ Broski ready (${INSTALLED_VERSION})"
echo ""
echo "  Next steps:"
echo "    broski install       # start the background daemon + bridge"
echo "    broski-link pair     # show the QR code to pair your phone"
echo ""
