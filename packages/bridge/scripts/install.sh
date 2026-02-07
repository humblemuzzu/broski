#!/bin/sh
set -e

# ──────────────────────────────────────────────
# Broski Bridge — Installer for macOS & Linux
# ──────────────────────────────────────────────
# Usage:
#   curl -fsSL https://broskiapp.com/install.sh | sh

VERSION="0.1.0"
BASE_URL="https://broskiapp.com/download"
INSTALL_DIR="$HOME/.broski/bin"
# ANALYTICS_URL removed — endpoint disabled to prevent unauthenticated abuse

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
echo "  Downloaded to ${INSTALL_DIR}/broski"

# ── Download signature file (integrity verification) ──
echo "  Downloading signature..."
if curl -fSL "${BASE_URL}/${BINARY_NAME}.sig" -o "${INSTALL_DIR}/broski.sig" 2>/dev/null; then
  echo "  Signature downloaded to ${INSTALL_DIR}/broski.sig"
else
  echo "  ⚠ Signature not available (binary will still work, sentinel check active)"
  rm -f "${INSTALL_DIR}/broski.sig" 2>/dev/null
fi
echo ""

# ── Add to PATH ──────────────────────────────
add_to_path() {
  PROFILE_FILE="$1"
  EXPORT_LINE="export PATH=\"${INSTALL_DIR}:\$PATH\""

  if [ -f "$PROFILE_FILE" ]; then
    if grep -q "$INSTALL_DIR" "$PROFILE_FILE" 2>/dev/null; then
      return 0  # Already in PATH config
    fi
  fi

  echo "" >> "$PROFILE_FILE"
  echo "# Broski" >> "$PROFILE_FILE"
  echo "$EXPORT_LINE" >> "$PROFILE_FILE"
  echo "  Added to PATH in ${PROFILE_FILE}"
}

# Detect shell (used for PATH config and success message)
CURRENT_SHELL=$(basename "${SHELL:-/bin/sh}")

# Check if already in PATH
case ":$PATH:" in
  *":${INSTALL_DIR}:"*)
    echo "  Already in PATH."
    ;;
  *)
    case "$CURRENT_SHELL" in
      zsh)
        add_to_path "$HOME/.zshrc"
        ;;
      bash)
        add_to_path "$HOME/.bashrc"
        ;;
      fish)
        # Fish uses a different mechanism
        if ! fish -c "echo \$PATH" 2>/dev/null | grep -q "$INSTALL_DIR"; then
          fish -c "set -Ux fish_user_paths $INSTALL_DIR \$fish_user_paths" 2>/dev/null || true
          echo "  Added to PATH via fish universal variable."
        fi
        ;;
      *)
        # Fallback: try .profile
        add_to_path "$HOME/.profile"
        ;;
    esac
    ;;
esac

# ── Track install (disabled — endpoint removed) ──

# ── Done ─────────────────────────────────────
echo ""
echo "  Broski v${VERSION} installed successfully!"
echo ""
echo "  Next steps:"
echo "    1. Restart your terminal (or run: source ~/.${CURRENT_SHELL:-bash}rc)"
echo "    2. Run 'broski setup' to get started."
echo ""
