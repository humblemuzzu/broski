# Carried over from the Flutter app

The native code and identifiers of the deleted Flutter app that the native apps (rebuild Phase 4) reuse.
The whole Flutter tree is on branch `final-flutter`. Push design: `docs/architecture/connectivity-v2/push.md`.

## iOS (`apps/ios/carryover/`)

| File | What it does |
|---|---|
| `NotificationService/NotificationService.swift` | The notification service extension. Opens the sealed body of a relay push (`e`, ChaCha20-Poly1305 under the machine's notify key, AAD = machine id) and replaces the relay's placeholder title and body with the machine's; threads by session; copies `backend`, `session` and `request` into `userInfo` for the decision handler; words the relay's own `offline`/`asleep` alert with the machine's name. |
| `NotificationService/Info.plist`, `NotificationService.entitlements` | The extension's plist (`com.apple.usernotifications.service`, `BroskiKeychainGroup`) and its keychain group. |
| `Shared/NotificationCrypto.swift` | The push crypto both targets share: notify and letter keys derived from the per-machine 32-byte key by HMAC-SHA256 over `broski-notify-v1` / `broski-letter-v1`; seal and open of `nonce ‖ ciphertext ‖ tag`; base64url. |
| `Shared/PushKeychainItem.swift` | Reads one machine's push credentials (machine id and name, relay, device id, relay token, key) from the shared keychain group. |
| `Runner/PushNotifications.swift` | The app side: the `approval` (Approve/Deny, authentication required), `attention`, `done` and `offline` categories; the APNs token; a lock-screen decision sealed as a letter (letter key, AAD = `machineId:deviceId`) and posted to the relay's `/v1/letters` with `x-broski-machine`, `x-broski-device` and the relay bearer token. Its Flutter method channels (`broski/push`, `broski/notification_taps`) are what Phase 4 replaces. |
| `Runner/Info.plist` | The app's plist: usage strings, Bonjour services, background modes, `BroskiKeychainGroup`. |
| `Runner/Runner.entitlements` | APNs environment and keychain groups. |

Identifiers read from the old project (`ios/Runner.xcodeproj/project.pbxproj` and the files above):

- Bundle id `com.muzammil.broski`; notification extension `com.muzammil.broski.NotificationService`.
- Team `FGYQ983C57`; deployment target iOS 15.0.
- Keychain access groups: `$(AppIdentifierPrefix)com.muzammil.broski` (app) and `$(AppIdentifierPrefix)com.muzammil.broski.push` (app and extension; `BroskiKeychainGroup` = `$(DEVELOPMENT_TEAM).com.muzammil.broski.push`).
- No app group.
- `aps-environment` `development`; background mode `remote-notification`.
- Bonjour services `_broski-link._tcp` (the daemon's LAN listener), `_http._tcp`, `_https._tcp`; `NSAllowsLocalNetworking`.
- The keychain item is a generic password with service `flutter_secure_storage_service` and account `broski_push_<machineId>`, the names the Flutter plugin wrote; the native app may choose its own, changing `PushKeychainItem.swift` with them.

## Android

The Android project held only Flutter's generated `MainActivity`; no native code is carried over.

- `applicationId` and `namespace` `com.muzammil.broski`.
- Cleartext traffic was permitted (`network_security_config.xml`) for direct LAN connections to `broski-link`, whose payload is Noise-encrypted end to end; the relay is `wss://`.
