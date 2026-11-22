#!/usr/bin/env bash
# Builds the iOS app from this checkout and serves it over Tailscale for the iPhone to install from Safari.
# Usage:
#   scripts/send-ios-to-phone.sh          # build & serve over Tailscale (prints URL; /pair gives a fresh pairing link)
#   scripts/send-ios-to-phone.sh --stop   # stop the broski-phone server and clear tailscale serve
#
# Needs the Tailscale CLI, signed in, on this Mac and on the iPhone. The page is served at
# https://<host>/<prefix>/:
#   BROSKI_OTA_HOST    the host the phone opens; default this Mac's tailnet DNS name (MagicDNS)
#   BROSKI_OTA_PREFIX  the URL's secret path segment; default a random token kept in
#                      apps/ios/Broski/build/phone/token
#   BROSKI_PHONE_PORT  the loopback port `tailscale serve` publishes (default 8744)
#
# For local Wi-Fi/USB installs without Tailscale, use scripts/install-ios-wifi.sh instead.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
source "$ROOT/scripts/lib/broski-core.sh"
source "$ROOT/scripts/lib/ios-phone-archive.sh"

WWW="$PHONE_OUT/www"
PORT="${BROSKI_PHONE_PORT:-8744}"
TAILSCALE="$(command -v tailscale || echo /Applications/Tailscale.app/Contents/MacOS/Tailscale)"

if [[ ${1:-} == --stop ]]; then
  tmux kill-session -t broski-phone 2>/dev/null || true
  if [[ -x $TAILSCALE ]]; then
    "$TAILSCALE" serve reset >/dev/null 2>&1 || true
  fi
  echo "==> Stopped broski-phone server and cleared tailscale serve"
  exit 0
fi

if [[ ! -x $TAILSCALE ]]; then
  echo "error: the Tailscale CLI is not installed ($TAILSCALE). Install Tailscale and sign in, or install" >&2
  echo "       over Wi-Fi or USB with scripts/install-ios-wifi.sh" >&2
  exit 1
fi
if [[ -n ${BROSKI_OTA_PREFIX:-} && ! $BROSKI_OTA_PREFIX =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "error: BROSKI_OTA_PREFIX must be one path segment of letters, digits, '-' or '_'" >&2
  exit 64
fi

archive_ios_for_phone
export_ios_phone_ipa

mkdir -p "$WWW"
cp "$PHONE_EXPORT/Broski.ipa" "$WWW/Broski.ipa.new"
mv "$WWW/Broski.ipa.new" "$WWW/Broski.ipa"
cp "$PHONE_STAGE/Broski/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png" "$WWW/icon.png"
echo "Build $PHONE_BUILD, $(git -C "$ROOT" log -1 --format='%h %s' | cut -c1-60)" >"$WWW/built.txt"

TOKEN_FILE="$PHONE_OUT/token"
if [[ -n ${BROSKI_OTA_PREFIX:-} && $(cat "$TOKEN_FILE" 2>/dev/null) != "$BROSKI_OTA_PREFIX" ]]; then
  printf '%s\n' "$BROSKI_OTA_PREFIX" >"$TOKEN_FILE"
  # A running server still serves the old prefix.
  tmux kill-session -t broski-phone 2>/dev/null || true
fi
[[ -f $TOKEN_FILE ]] || openssl rand -hex 6 >"$TOKEN_FILE"
TOKEN="$(cat "$TOKEN_FILE")"
if ! tmux has-session -t broski-phone 2>/dev/null; then
  if [[ $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/") != 000 ]]; then
    echo "error: something else listens on 127.0.0.1:$PORT; set BROSKI_PHONE_PORT" >&2
    exit 1
  fi
  tailnet_ip="$("$TAILSCALE" ip -4 | head -1)"
  tmux new-session -d -s broski-phone \
    "exec python3 '$ROOT/scripts/lib/phone-install-server.py' '$WWW' '$TOKEN' '$PORT' '$tailnet_ip'"
  sleep 1
fi
"$TAILSCALE" serve --bg "http://127.0.0.1:$PORT" >/dev/null

host="${BROSKI_OTA_HOST:-}"
if [[ -z $host ]]; then
  host="$("$TAILSCALE" status --json 2>/dev/null |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null)" || host=""
fi
if [[ -z $host ]]; then
  echo "error: Tailscale reported no DNS name for this Mac (signed out, or MagicDNS off)." >&2
  echo "       Set BROSKI_OTA_HOST to the name the phone opens, e.g. BROSKI_OTA_HOST=my-mac.example.ts.net" >&2
  exit 1
fi
url="https://$host/$TOKEN/"
if ! curl -fs "${url}Broski.ipa" | cmp -s - "$WWW/Broski.ipa"; then
  echo "error: $url does not serve the new build" >&2
  exit 1
fi
echo "==> Open on the iPhone (Tailscale on): $url"
