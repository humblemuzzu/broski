# shellcheck shell=bash
# Shared staging and archiving for installing Broski on the user's physical iPhone, used by both
# scripts/install-ios-wifi.sh (direct devicectl install) and scripts/send-ios-to-phone.sh (Tailscale OTA).
# Both reuse the single directory apps/ios/Broski/build/phone so repeated installs never accumulate
# duplicate gigabyte-sized staging or DerivedData copies.

PHONE_OUT="$ROOT/apps/ios/Broski/build/phone"
PHONE_STAGE="$PHONE_OUT/stage/apps/ios"
PHONE_ARCHIVE="$PHONE_OUT/Broski.xcarchive"
PHONE_EXPORT="$PHONE_OUT/export"
PHONE_DERIVED="$PHONE_OUT/DerivedData"

archive_ios_for_phone() {
  if ios_core_is_stale; then
    "$ROOT/scripts/build-ios-core.sh"
  fi

  echo "==> Staging the app in $PHONE_STAGE"
  mkdir -p "$PHONE_STAGE"
  rsync -a --delete --exclude /build/ --exclude /Broski.xcodeproj/ "$ROOT/apps/ios/Broski/" "$PHONE_STAGE/Broski/"
  rsync -a --delete --exclude /.build/ "$ROOT/apps/ios/BroskiCore/" "$PHONE_STAGE/BroskiCore/"
  rsync -a --delete --exclude /.build/ "$ROOT/apps/ios/BroskiPush/" "$PHONE_STAGE/BroskiPush/"
  for entitlements in "$PHONE_STAGE/Broski/Resources/Broski.entitlements" \
    "$PHONE_STAGE/Broski/Extensions/NotificationService/NotificationService.entitlements"; do
    /usr/libexec/PlistBuddy -c 'Delete :com.apple.security.application-groups' "$entitlements" 2>/dev/null || true
  done
  xcodegen generate --spec "$PHONE_STAGE/Broski/project.yml" --project "$PHONE_STAGE/Broski" --quiet

  PHONE_BUILD="$(date +%y%m%d%H%M)"
  echo "==> Archiving build $PHONE_BUILD"
  rm -rf "$PHONE_ARCHIVE" "$PHONE_EXPORT"
  xcodebuild archive -quiet -allowProvisioningUpdates \
    -project "$PHONE_STAGE/Broski/Broski.xcodeproj" -scheme Broski -configuration Release \
    -destination 'generic/platform=iOS' -archivePath "$PHONE_ARCHIVE" -derivedDataPath "$PHONE_DERIVED" \
    CURRENT_PROJECT_VERSION="$PHONE_BUILD"
}

export_ios_phone_ipa() {
  local team
  team="$(sed -n 's/^ *DEVELOPMENT_TEAM: *//p' "$ROOT/apps/ios/Broski/project.yml" | head -1)"
  cat >"$PHONE_OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>debugging</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>$team</string>
  <key>thinning</key><string>&lt;none&gt;</string>
</dict></plist>
PLIST
  xcodebuild -exportArchive -quiet -allowProvisioningUpdates \
    -archivePath "$PHONE_ARCHIVE" -exportPath "$PHONE_EXPORT" -exportOptionsPlist "$PHONE_OUT/ExportOptions.plist"
}
