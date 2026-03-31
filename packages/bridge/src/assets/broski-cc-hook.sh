#!/usr/bin/env bash
# Broski CC Permission Hook
# Called by Claude Code's PreToolUse hook system.
# Reads tool input JSON from stdin, sends to Broski bridge, returns decision.
#
# Environment variables:
#   BROSKI_BRIDGE_URL   — Bridge URL (default: http://127.0.0.1:$BROSKI_BRIDGE_PORT)
#   BROSKI_BRIDGE_PORT  — Bridge port (default: 7681)
#   BROSKI_BRIDGE_TOKEN — Auth token (required; if missing, returns {} to not interfere)

set -euo pipefail

# Read the hook input from stdin
INPUT=$(cat)

# Bridge connection details are passed via environment variables
BRIDGE_URL="${BROSKI_BRIDGE_URL:-http://127.0.0.1:${BROSKI_BRIDGE_PORT:-7681}}"
BRIDGE_TOKEN="${BROSKI_BRIDGE_TOKEN:-}"

if [ -z "$BRIDGE_TOKEN" ]; then
  # No token means bridge is not configured — don't interfere
  echo '{}'
  exit 0
fi

# Send to bridge and get decision
RESPONSE=$(curl -s --max-time 310 \
  -X POST "${BRIDGE_URL}/cc-hook" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${BRIDGE_TOKEN}" \
  -d "$INPUT" 2>/dev/null) || true

if [ -z "$RESPONSE" ]; then
  # Bridge unreachable — return empty (CC shows normal dialog)
  echo '{}'
  exit 0
fi

echo "$RESPONSE"
