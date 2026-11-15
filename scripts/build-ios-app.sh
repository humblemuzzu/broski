#!/usr/bin/env bash
# Builds the iOS app (apps/ios/Broski): BroskiCore first when its outputs are missing or older than
# anything under packages/link, then the Xcode project from project.yml, then the app.
#
# Usage: scripts/build-ios-app.sh [simulator|device] [--unsigned] [--test]
#   simulator   (default) any iOS Simulator
#   device      any iOS device; --unsigned builds without code signing (no provisioning profile)
#   --test      runs the unit tests on the simulator named by $BROSKI_SIMULATOR (default "iPhone Duo")
# DERIVED_DATA overrides the derived data path (default apps/ios/Broski/build/DerivedData).
# Needs macOS with Xcode, XcodeGen, and what scripts/build-ios-core.sh needs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/apps/ios/Broski"
XCFRAMEWORK="$ROOT/apps/ios/BroskiCore/BroskiCoreFFI.xcframework"
DERIVED="${DERIVED_DATA:-$APP/build/DerivedData}"

platform=simulator
signing=()
action=build
for arg in "$@"; do
  case $arg in
    simulator | device) platform=$arg ;;
    --unsigned) signing=(CODE_SIGNING_ALLOWED=NO) ;;
    --test) action=test ;;
    *)
      echo "usage: $0 [simulator|device] [--unsigned] [--test]" >&2
      exit 64
      ;;
  esac
done

core_is_stale() {
  [[ ! -f $XCFRAMEWORK/Info.plist ]] && return 0
  [[ -n $(find "$ROOT/packages/link" -path '*/target' -prune -o -type f -newer "$XCFRAMEWORK/Info.plist" -print -quit) ]]
}

if core_is_stale; then
  "$ROOT/scripts/build-ios-core.sh"
fi

echo "==> Generating Broski.xcodeproj"
xcodegen generate --spec "$APP/project.yml" --project "$APP" --quiet

if [[ $action == test ]]; then
  destination="platform=iOS Simulator,name=${BROSKI_SIMULATOR:-iPhone Duo}"
elif [[ $platform == device ]]; then
  destination="generic/platform=iOS"
else
  destination="generic/platform=iOS Simulator"
fi

echo "==> xcodebuild $action ($destination)"
xcodebuild "$action" \
  -project "$APP/Broski.xcodeproj" \
  -scheme Broski \
  -destination "$destination" \
  -derivedDataPath "$DERIVED" \
  ${signing[@]+"${signing[@]}"}
