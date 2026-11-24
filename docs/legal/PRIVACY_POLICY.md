# Privacy Policy

**Effective Date:** November 24, 2026
**Last Updated:** November 24, 2026

Broski is a free, open-source (MIT) phone remote for AI coding agents running on your own Mac, built by humblemuzzu ("we," "us," or "our"). This policy explains how the Broski iOS and Android apps ("App") and the website at [broskiapp.com](https://broskiapp.com) handle data.

## The short version

- **No accounts, no cloud database, no subscriptions.** Broski runs no servers that store your code, prompts, chats, files, or API keys.
- **End-to-end encrypted.** Everything between your phone and your Mac is encrypted with Noise (hybrid X25519 + ML-KEM-768), directly on your LAN when possible or through a blind relay you configure.
- **No ads or tracking SDKs in the App.** The mobile apps include no advertising SDKs, no crash-reporting SDKs, and no analytics SDKs.

## 1. Data stored on your devices

Broski stores what it needs locally on your own devices:

| Data | Where it lives | Why it is kept |
|---|---|---|
| Device encryption key pair, paired Mac public keys/fingerprints, LAN addresses, and relay tokens | iOS Keychain / Android Keystore (hardware-backed encryption) | Authenticating and encrypting connections to your paired Macs |
| Last known inbox rows, read/unread markers, pinned/muted sessions, and app preferences | Local app storage on your phone | Fast launch, remembering appearance, notification switches, and session state |
| Optional xAI API key (if you add one for dictation) | iOS Keychain / Android Keystore | Authenticating your own voice transcription requests directly with xAI |
| Paired device list (device name, public key, notification preferences) | `~/.broski/link/` on your Mac | Authorizing paired phones, filtering alerts, and letting you revoke devices |

None of this data is sent to us.

## 2. Device permissions we request

The App asks for OS permissions only when you use the feature that needs them:

- **Camera:** Used to scan the pairing QR code on your Mac and to take photos you choose to attach to a prompt.
- **Photo Library:** Used when you pick images to attach to a prompt or save images from a session or file to your library.
- **Microphone & Speech Recognition:** Used only while you actively hold or tap the mic button to dictate a prompt.
- **Local Network (Bonjour):** Used on iOS to discover your paired Mac on the same Wi-Fi network for direct local connections.
- **Notifications:** Used to deliver approval prompts, agent questions, finished/failed run alerts, and Live Activities / Live Updates when you opt in.

## 3. Third-party services (only when you use them)

Because Broski drives the agents and services you choose, some features talk directly to third-party services under your own configuration:

- **Your AI coding providers:** Your prompts, code, and files go directly from your Mac to the AI providers configured in your local Claude Code or Pi setup (such as [Anthropic](https://www.anthropic.com/privacy), [OpenAI](https://openai.com/privacy), or [Google](https://policies.google.com/privacy)). They never pass through us.
- **Voice dictation (optional xAI key):** When you add your own xAI API key in Settings › Voice, recordings and a short list of up to 100 workspace/session terms (file names, symbols, commands) are sent over HTTPS directly from your phone to xAI (`api.x.ai/v1/stt`) under your key; see the [xAI Privacy Policy](https://x.ai/legal/privacy-policy). Without a key, Broski uses your phone's built-in Apple or Google speech recognition instead.
- **Relay (optional, when away from home):** If you configure a relay (such as a self-hosted `broski-relay`), traffic between your phone and Mac remains end-to-end encrypted. The relay cannot read prompts, code, or chat contents; it can see connection metadata (machine/device IDs, timing, message sizes) and, if push notifications are enabled, encrypted push envelopes plus your push token.
- **Push notifications (APNs / FCM):** When paired with a push-enabled relay, your phone registers an Apple APNs or Google FCM push token with your Mac so alerts reach your lock screen. Alert titles and bodies are encrypted by your Mac and decrypted on your phone.

## 4. Website analytics (`broskiapp.com`)

The marketing website at [broskiapp.com](https://broskiapp.com) uses [Piqo](https://piqo.app) in **cookieless mode** (`data-cookieless`) to count basic pageviews and link clicks. It sets no cookies, collects no personal profiles, and does not track you across sites. The Broski mobile apps and Mac bridge do not use Piqo or any other analytics service.

## 5. Data retention and deletion

- **On your phone:** Forget a paired Mac in Settings › Machines, clear your xAI key in Settings › Voice, or uninstall the App to erase all locally stored data.
- **On your Mac:** Run `broski-link revoke <id>` to remove a paired phone, or delete `~/.broski/` to remove all local state.
- **On our servers:** We do not operate a user database and hold no copy of your data to delete.

## 6. Children's privacy

Broski is a software development tool and is not directed at children under 13. We do not knowingly collect personal information from children.

## 7. Changes and contact

If this policy changes, we will update the date at the top of this page and commit the change publicly in the [GitHub repository](https://github.com/humblemuzzu/broski).

Questions or privacy requests: **broskiappp@gmail.com**. For security issues, see [SECURITY.md](https://github.com/humblemuzzu/broski/blob/main/SECURITY.md).
