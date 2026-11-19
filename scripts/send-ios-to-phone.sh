#!/usr/bin/env bash
# Builds the iOS app from this checkout and serves it over Tailscale for the iPhone to install from Safari.
# Usage:
#   scripts/send-ios-to-phone.sh          # build & serve over Tailscale (prints URL; /pair gives a fresh pairing link)
#   scripts/send-ios-to-phone.sh --stop   # stop the broski-phone server and clear tailscale serve
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

archive_ios_for_phone
export_ios_phone_ipa

mkdir -p "$WWW"
cp "$PHONE_EXPORT/Broski.ipa" "$WWW/Broski.ipa.new"
mv "$WWW/Broski.ipa.new" "$WWW/Broski.ipa"
cp "$PHONE_STAGE/Broski/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png" "$WWW/icon.png"
echo "Build $PHONE_BUILD, $(git -C "$ROOT" log -1 --format='%h %s' | cut -c1-60)" >"$WWW/built.txt"

[[ -f $PHONE_OUT/token ]] || openssl rand -hex 6 >"$PHONE_OUT/token"
TOKEN="$(cat "$PHONE_OUT/token")"
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

host="$("$TAILSCALE" status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
url="https://$host/$TOKEN/"
if ! curl -fs "${url}Broski.ipa" | cmp -s - "$WWW/Broski.ipa"; then
  echo "error: $url does not serve the new build" >&2
  exit 1
fi
echo "==> Open on the iPhone (Tailscale on): $url"
