#!/bin/sh
set -e

# ──────────────────────────────────────────────
# Broski Bridge — One-Line Installer
# ──────────────────────────────────────────────
# Usage:
#   curl -fsSL https://broskiapp.com/install.sh | sh
#   curl -fsSL https://broskiapp.com/install.sh | sh -s -- --install-service
#
# BROSKI_BASE_URL overrides the download directory (used to install from a
# locally built release).

VERSION="0.1.0"
BASE_URL="${BROSKI_BASE_URL:-https://broskiapp.com/download}"
INSTALL_DIR="$HOME/.broski/bin"

INSTALL_SERVICE=0
for arg in "$@"; do
  case "$arg" in
    --install-service) INSTALL_SERVICE=1 ;;
    --help|-h)
      echo "Usage: install.sh [--install-service]"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      exit 1
      ;;
  esac
done

echo ""
echo "  ____                _    _ "
echo " | __ ) _ __ ___  ___| | _(_)"
echo " |  _ \\| '__/ _ \\/ __| |/ / |"
echo " | |_) | | | (_) \\__ \\   <| |"
echo " |____/|_|  \\___/|___/_|\\_\\_|"
echo ""
echo "  Installing Broski v${VERSION}..."
echo ""

# ── Detect OS ────────────────────────────────
OS_RAW=$(uname -s)
case "$OS_RAW" in
  Darwin)  OS="darwin" ;;
  Linux)   OS="linux" ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    echo "  Error: Windows detected."
    echo "  Note: Broski Link is not supported on Windows yet."
    echo "  Please use the PowerShell installer instead:"
    echo ""
    echo "    irm https://broskiapp.com/install.ps1 | iex"
    echo ""
    exit 1
    ;;
  *)
    echo "  Error: Unsupported operating system '${OS_RAW}'."
    echo "  Broski supports macOS and Linux."
    exit 1
    ;;
esac

# ── Detect Architecture ─────────────────────
ARCH_RAW=$(uname -m)
case "$ARCH_RAW" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64)  ARCH="x64" ;;
  *)
    echo "  Error: Unsupported architecture '${ARCH_RAW}'."
    echo "  Broski supports arm64 and x86_64."
    exit 1
    ;;
esac

TARGET="${OS}-${ARCH}"
BINARY_NAME="broski-${TARGET}"
LINK_NAME="broski-link-${TARGET}"

echo "  Platform: ${TARGET}"
echo ""

# ── Create install directory ─────────────────
mkdir -p "$INSTALL_DIR"

# ── Checksum helpers ─────────────────────────
# The release publishes SHA256SUMS (one "<hash>  <filename>" line per artifact);
# there is no published public key for the .sig files, so hashes are the
# verification mechanism.

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
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

# ── Download checksums ───────────────────────
echo "  Downloading SHA256SUMS..."
if ! curl -fSL "${BASE_URL}/SHA256SUMS" -o "${INSTALL_DIR}/SHA256SUMS"; then
  echo "  Error: could not download ${BASE_URL}/SHA256SUMS"
  echo "  Refusing to install an unverified binary."
  exit 1
fi

# ── Download binary ──────────────────────────
echo "  Downloading ${BINARY_NAME}..."
curl -fSL "${BASE_URL}/${BINARY_NAME}" -o "${INSTALL_DIR}/broski"
chmod +x "${INSTALL_DIR}/broski"
verify_sha256 "${INSTALL_DIR}/broski" "${BINARY_NAME}"

# ── Download broski-link (always-on service supervisor) ──
# broski-link owns the always-on service: it spawns the bridge and restarts it.
echo "  Downloading ${LINK_NAME}..."
if curl -fSL "${BASE_URL}/${LINK_NAME}" -o "${INSTALL_DIR}/broski-link"; then
  chmod +x "${INSTALL_DIR}/broski-link"
  verify_sha256 "${INSTALL_DIR}/broski-link" "${LINK_NAME}"
else
  rm -f "${INSTALL_DIR}/broski-link" 2>/dev/null
  echo "  ⚠ broski-link is not published for ${TARGET}"
  echo "    Always On (broski install) needs it: build with 'cd packages/link && cargo build --release'"
fi

# ── Download native PTY library ──────────────
# Enables terminal sessions from the app. Optional — bridge works without it
# if OpenCode is running, but needed for standalone terminal access.
PTY_LIB=""
case "$OS" in
  darwin) PTY_LIB="libbroski_pty.dylib" ;;
  linux)  PTY_LIB="libbroski_pty.so" ;;
esac

if [ -n "$PTY_LIB" ]; then
  if curl -fSL "${BASE_URL}/${PTY_LIB}" -o "${INSTALL_DIR}/${PTY_LIB}" 2>/dev/null; then
    if [ -n "$(expected_sha256 "$PTY_LIB")" ]; then
      verify_sha256 "${INSTALL_DIR}/${PTY_LIB}" "${PTY_LIB}"
    else
      echo "  ✓ PTY library installed (not listed in SHA256SUMS)"
    fi
  else
    echo "  ⚠ PTY library not available (terminal still works via OpenCode)"
    rm -f "${INSTALL_DIR}/${PTY_LIB}" 2>/dev/null
  fi
fi

echo ""

# ── Add to PATH ──────────────────────────────
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

# ── Source PATH immediately ──────────────────
# So `broski` works right now without restarting the terminal
export PATH="${INSTALL_DIR}:$PATH"

# ── Background service ───────────────────────
if [ "$INSTALL_SERVICE" = "1" ]; then
  echo ""
  echo "  Installing the Broski Link background service..."
  echo ""
  "${INSTALL_DIR}/broski" install
  echo ""
else
  echo ""
  echo "  Keep Broski running in the background:"
  echo ""
  echo "    broski install"
  echo ""
fi

# ── Done ─────────────────────────────────────
echo ""
echo "  ✅ Broski v${VERSION} installed!"
echo ""
echo "  Run this now:"
echo ""
echo "    source ~/.${CURRENT_SHELL}rc && broski setup"
echo ""
