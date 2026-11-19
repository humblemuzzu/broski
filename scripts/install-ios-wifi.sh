#!/usr/bin/env bash
# Builds the iOS app from this checkout and installs + launches it directly on the paired physical
# iPhone over local Wi-Fi or USB using `xcrun devicectl`. Reuses apps/ios/Broski/build/phone so
# repeated installs never create duplicate build folders or start a Tailscale server.
#
# Usage: scripts/install-ios-wifi.sh [--no-launch]
# Set BROSKI_IOS_DEVICE to a devicectl device UUID or UDID if more than one physical iPhone is paired.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
source "$ROOT/scripts/lib/broski-core.sh"
source "$ROOT/scripts/lib/ios-phone-archive.sh"

launch=1
for arg in "$@"; do
  case $arg in
    --no-launch) launch=0 ;;
    *)
      echo "usage: $0 [--no-launch]" >&2
      exit 64
      ;;
  esac
done

resolve_device() {
  if [[ -n ${BROSKI_IOS_DEVICE:-} ]]; then
    echo "$BROSKI_IOS_DEVICE"
    return 0
  fi
  local json
  json="$(mktemp)"
  trap 'rm -f "$json"' RETURN
  xcrun devicectl list devices --json-output "$json" >/dev/null
  /usr/bin/python3 - "$json" <<'PY'
import json, sys

data = json.load(open(sys.argv[1]))
devices = data.get("result", {}).get("devices", [])
candidates = []
for dev in devices:
    hw = dev.get("hardwareProperties", {})
    conn = dev.get("connectionProperties", {})
    if hw.get("platform") != "iOS" or hw.get("reality") != "physical":
        continue
    if conn.get("pairingState") != "paired":
        continue
    identifier = dev.get("identifier") or hw.get("udid")
    if identifier:
        state = conn.get("tunnelState") or ""
        score = 0 if state == "connected" else 1
        candidates.append((score, identifier, dev.get("deviceProperties", {}).get("name", "")))

if not candidates:
    sys.exit("error: no paired physical iPhone found via xcrun devicectl; set BROSKI_IOS_DEVICE")
candidates.sort()
print(candidates[0][1])
PY
}

device="$(resolve_device)"
archive_ios_for_phone

app_bundle="$PHONE_ARCHIVE/Products/Applications/Broski.app"
echo "==> Installing build $PHONE_BUILD on device $device"
xcrun devicectl device install app --device "$device" "$app_bundle"

if ((launch == 1)); then
  echo "==> Launching com.muzammil.broski"
  xcrun devicectl device process launch --device "$device" com.muzammil.broski
fi
echo "==> Done: build $PHONE_BUILD installed on $device"
