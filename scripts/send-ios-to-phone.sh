#!/usr/bin/env bash
# Builds the iOS app from this checkout and serves it over Tailscale for the iPhone to install from Safari.
# Usage: scripts/send-ios-to-phone.sh   (prints the page's URL; /pair under it gives a fresh pairing link)
#
# A Release archive exported for development, signed automatically for the project's team, so the phone must be one
# of the team's devices. A copy of the app under build/phone/stage differs from the committed project in two ways:
# the build number is the time, since an iPhone only replaces an installed app with a newer one; and the App Group
# entitlement is dropped, since no profile on the team includes it yet (the notification extension then reads its
# default preferences). The page is scripts/lib/phone-install-server.py on 127.0.0.1:$PORT in the tmux session
# broski-phone, published on the tailnet only by `tailscale serve`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/lib/broski-core.sh"
OUT="$ROOT/apps/ios/Broski/build/phone"
STAGE="$OUT/stage/apps/ios"
WWW="$OUT/www"
PORT="${BROSKI_PHONE_PORT:-8744}"
TEAM="$(sed -n 's/^ *DEVELOPMENT_TEAM: *//p' "$ROOT/apps/ios/Broski/project.yml" | head -1)"
TAILSCALE="$(command -v tailscale || echo /Applications/Tailscale.app/Contents/MacOS/Tailscale)"

if ios_core_is_stale; then
  "$ROOT/scripts/build-ios-core.sh"
fi

echo "==> Staging the app"
mkdir -p "$STAGE" "$WWW"
rsync -a --delete --exclude /build/ --exclude /Broski.xcodeproj/ "$ROOT/apps/ios/Broski/" "$STAGE/Broski/"
rsync -a --delete --exclude /.build/ "$ROOT/apps/ios/BroskiCore/" "$STAGE/BroskiCore/"
for entitlements in "$STAGE/Broski/Resources/Broski.entitlements" \
  "$STAGE/Broski/Extensions/NotificationService/NotificationService.entitlements"; do
  /usr/libexec/PlistBuddy -c 'Delete :com.apple.security.application-groups' "$entitlements" 2>/dev/null || true
done
xcodegen generate --spec "$STAGE/Broski/project.yml" --project "$STAGE/Broski" --quiet

BUILD="$(date +%y%m%d%H%M)"
echo "==> Archiving build $BUILD"
rm -rf "$OUT/Broski.xcarchive" "$OUT/export"
xcodebuild archive -quiet -allowProvisioningUpdates \
  -project "$STAGE/Broski/Broski.xcodeproj" -scheme Broski -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/Broski.xcarchive" -derivedDataPath "$OUT/DerivedData" \
  CURRENT_PROJECT_VERSION="$BUILD"

cat >"$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>debugging</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>$TEAM</string>
  <key>thinning</key><string>&lt;none&gt;</string>
</dict></plist>
PLIST
xcodebuild -exportArchive -quiet -allowProvisioningUpdates \
  -archivePath "$OUT/Broski.xcarchive" -exportPath "$OUT/export" -exportOptionsPlist "$OUT/ExportOptions.plist"

cp "$OUT/export/Broski.ipa" "$WWW/Broski.ipa.new"
mv "$WWW/Broski.ipa.new" "$WWW/Broski.ipa"
cp "$STAGE/Broski/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png" "$WWW/icon.png"
echo "Build $BUILD, $(git -C "$ROOT" log -1 --format='%h %s' | cut -c1-60)" >"$WWW/built.txt"

[[ -f $OUT/token ]] || openssl rand -hex 6 >"$OUT/token"
TOKEN="$(cat "$OUT/token")"
if ! tmux has-session -t broski-phone 2>/dev/null; then
  if [[ $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/") != 000 ]]; then
    echo "error: something else listens on 127.0.0.1:$PORT; set BROSKI_PHONE_PORT" >&2
    exit 1
  fi
  tailnet_ip="$("$TAILSCALE" ip -4 | head -1)"
  tmux new-session -d -s broski-phone \
    "python3 '$ROOT/scripts/lib/phone-install-server.py' '$WWW' '$TOKEN' '$PORT' '$tailnet_ip'"
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
