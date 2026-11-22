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
# /pair runs `broski-link pair` with the first of $CARGO_TARGET_DIR's (or packages/link/target's)
# release/broski-link, broski-link on PATH, and ~/.broski/bin/broski-link.
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
IFS='|' read -r ts_state ts_name < <("$TAILSCALE" status --json 2>/dev/null | python3 -c '
import json, sys
try:
    status = json.load(sys.stdin)
except ValueError:
    status = {}
name = (status.get("Self") or {}).get("DNSName") or ""
print(status.get("BackendState", ""), name.rstrip("."), sep="|")') || true
if [[ ${ts_state:-} != Running ]]; then
  echo "error: Tailscale is not running on this Mac (state: ${ts_state:-unknown}). Open Tailscale and sign in," >&2
  echo "       or install over Wi-Fi or USB with scripts/install-ios-wifi.sh" >&2
  exit 1
fi
host="${BROSKI_OTA_HOST:-$ts_name}"
if [[ -z $host ]]; then
  echo "error: Tailscale reported no DNS name for this Mac (MagicDNS off)." >&2
  echo "       Set BROSKI_OTA_HOST to the name the phone opens, e.g. BROSKI_OTA_HOST=my-mac.example.ts.net" >&2
  exit 1
fi
tailnet_ip="$("$TAILSCALE" ip -4 | head -1)"

link_bin=""
for candidate in "$LINK_TARGET/release/broski-link" "$(command -v broski-link || true)" "$HOME/.broski/bin/broski-link"; do
  if [[ -n $candidate && -x $candidate ]]; then
    link_bin="$candidate"
    break
  fi
done
[[ -n $link_bin ]] || echo "warning: no broski-link binary found; the install page's /pair will not work" >&2

archive_ios_for_phone
export_ios_phone_ipa

mkdir -p "$WWW"
cp "$PHONE_EXPORT/Broski.ipa" "$WWW/Broski.ipa.new"
mv "$WWW/Broski.ipa.new" "$WWW/Broski.ipa"
cp "$PHONE_STAGE/Broski/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png" "$WWW/icon.png"
echo "Build $PHONE_BUILD, $(git -C "$ROOT" log -1 --format='%h %s' | cut -c1-60)" >"$WWW/built.txt"
bundle_id="$(unzip -p "$WWW/Broski.ipa" Payload/Broski.app/Info.plist | plutil -extract CFBundleIdentifier raw -o - -)"

TOKEN_FILE="$PHONE_OUT/token"
if [[ -n ${BROSKI_OTA_PREFIX:-} ]]; then
  printf '%s\n' "$BROSKI_OTA_PREFIX" >"$TOKEN_FILE"
fi
[[ -f $TOKEN_FILE ]] || openssl rand -hex 6 >"$TOKEN_FILE"
TOKEN="$(cat "$TOKEN_FILE")"
server_cmd="exec python3 '$ROOT/scripts/lib/phone-install-server.py' '$WWW' '$TOKEN' '$PORT' '$tailnet_ip' '$link_bin' '$bundle_id'"
if [[ $(cat "$PHONE_OUT/server-cmd" 2>/dev/null) != "$server_cmd" ]]; then
  # A running server started with other arguments (prefix, broski-link, bundle id) serves stale pages.
  tmux kill-session -t broski-phone 2>/dev/null || true
fi
if ! tmux has-session -t broski-phone 2>/dev/null; then
  if [[ $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/") != 000 ]]; then
    echo "error: something else listens on 127.0.0.1:$PORT; set BROSKI_PHONE_PORT" >&2
    exit 1
  fi
  tmux new-session -d -s broski-phone "$server_cmd"
  printf '%s\n' "$server_cmd" >"$PHONE_OUT/server-cmd"
  sleep 1
fi
"$TAILSCALE" serve --bg "http://127.0.0.1:$PORT" >/dev/null

url="https://$host/$TOKEN/"
if ! curl -fs "${url}Broski.ipa" | cmp -s - "$WWW/Broski.ipa"; then
  echo "error: $url does not serve the new build" >&2
  exit 1
fi
echo "==> Open on the iPhone (Tailscale on): $url"
