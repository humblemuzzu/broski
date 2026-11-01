#!/bin/sh
# Builds scripts/cc-spike/compiled-probe.ts as a compiled binary with the host's Claude Code binary
# embedded exactly as scripts/build.sh embeds it (scripts/claude-cli-embed.sh), at dist/cc-compiled-probe.
# Usage: sh scripts/cc-spike/build-compiled-probe.sh   (from packages/bridge)
set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "${SCRIPT_DIR}/../.."
. ./scripts/claude-cli-embed.sh

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLATFORM=darwin-arm64 ;;
  Darwin-x86_64) PLATFORM=darwin-x64 ;;
  Linux-x86_64) PLATFORM=linux-x64 ;;
  Linux-aarch64) PLATFORM=linux-arm64 ;;
  *) echo "unsupported host $(uname -s)-$(uname -m)"; exit 1 ;;
esac

ENTRY="./scripts/cc-spike/_compiled_probe_entry.ts"
cleanup() { rm -f "$CLAUDE_EMBED" "$ENTRY"; }
trap cleanup EXIT

write_claude_cli_embed "$PLATFORM"
printf 'import "../../src/_claude_cli_embed";\nimport "./compiled-probe";\n' > "$ENTRY"
mkdir -p dist
bun build --compile --format=esm --target="bun-${PLATFORM}" "$ENTRY" --outfile dist/cc-compiled-probe
if command -v codesign >/dev/null 2>&1; then codesign -f -s - dist/cc-compiled-probe; fi
ls -l dist/cc-compiled-probe
