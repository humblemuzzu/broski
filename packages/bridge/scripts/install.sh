#!/bin/sh
set -e

# ──────────────────────────────────────────────
# Broski Bridge — One-Line Installer
# ──────────────────────────────────────────────
# Usage:
#   curl -fsSL https://broskiapp.com/install.sh | sh

VERSION="0.1.0"
BASE_URL="https://broskiapp.com/download"
INSTALL_DIR="$HOME/.broski/bin"

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

echo "  Platform: ${TARGET}"
echo ""

# ── Create install directory ─────────────────
mkdir -p "$INSTALL_DIR"

# ── Download binary ──────────────────────────
echo "  Downloading ${BINARY_NAME}..."
curl -fSL "${BASE_URL}/${BINARY_NAME}" -o "${INSTALL_DIR}/broski"
chmod +x "${INSTALL_DIR}/broski"
echo "  ✓ Binary installed"

# ── Download signature file (integrity verification) ──
if curl -fSL "${BASE_URL}/${BINARY_NAME}.sig" -o "${INSTALL_DIR}/broski.sig" 2>/dev/null; then
  echo "  ✓ Signature downloaded"
else
  rm -f "${INSTALL_DIR}/broski.sig" 2>/dev/null
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
    echo "  ✓ PTY library installed"
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

# ── Done ─────────────────────────────────────
echo ""
echo "  ✅ Broski v${VERSION} installed!"
echo ""
echo "  Run this now:"
echo ""
echo "    source ~/.${CURRENT_SHELL}rc && broski setup"
echo ""
