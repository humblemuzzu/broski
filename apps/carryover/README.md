# App identifiers

Bundle ids, keychain access groups, Bonjour service and Android application id used by the native apps. The iOS
notification service extension, decision letters and keychain lookup live in `apps/ios/Broski`
([`apps/ios/README.md`](../ios/README.md)), and the push crypto lives in `BroskiCore` (`openNotification`,
`decisionLetter`).

## iOS

- Bundle id `com.muzammil.broski`; notification extension `com.muzammil.broski.NotificationService`.
- Keychain access groups: `$(AppIdentifierPrefix)com.muzammil.broski` (app) and
  `$(AppIdentifierPrefix)com.muzammil.broski.push` (app and extension; `BroskiKeychainGroup` =
  `$(DEVELOPMENT_TEAM).com.muzammil.broski.push`).
- App group `group.com.muzammil.broski` for notification preferences shared between the app and its extension.
- `aps-environment` `development`.
- Bonjour service `_broski-link._tcp` (the daemon's LAN listener).

## Android

- `applicationId` and `namespace` `com.muzammil.broski`.
- Cleartext traffic is permitted (`network_security_config.xml`) for direct LAN connections to `broski-link`,
  whose payload is Noise-encrypted end to end; the relay is `wss://`.
