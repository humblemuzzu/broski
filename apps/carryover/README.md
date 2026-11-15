# Identifiers kept from the Flutter app

What the native apps keep from the deleted Flutter app, so an install of either reads as the same app. The
whole Flutter tree is on branch `final-flutter`. The iOS push code that was carried over here is ported:
the notification service extension, the decision letters and the keychain lookup are in `apps/ios/Broski`
(`apps/ios/README.md`), and the push crypto is the core's (`openNotification`, `decisionLetter`).

## iOS

Read from the old project (`ios/Runner.xcodeproj/project.pbxproj` and its push code):

- Bundle id `com.muzammil.broski`; notification extension `com.muzammil.broski.NotificationService`.
- Team `FGYQ983C57`.
- Keychain access groups: `$(AppIdentifierPrefix)com.muzammil.broski` (app) and
  `$(AppIdentifierPrefix)com.muzammil.broski.push` (app and extension; `BroskiKeychainGroup` =
  `$(DEVELOPMENT_TEAM).com.muzammil.broski.push`).
- `aps-environment` `development`.
- Bonjour service `_broski-link._tcp` (the daemon's LAN listener).

The old project had no app group; the native app adds `group.com.muzammil.broski` for the notification
preferences its extension reads.

## Android

The Android project held only Flutter's generated `MainActivity`; no native code is carried over.

- `applicationId` and `namespace` `com.muzammil.broski`.
- Cleartext traffic was permitted (`network_security_config.xml`) for direct LAN connections to `broski-link`,
  whose payload is Noise-encrypted end to end; the relay is `wss://`.
