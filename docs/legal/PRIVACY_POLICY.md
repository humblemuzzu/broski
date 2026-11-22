# Privacy Policy

**Effective Date:** February 13, 2026
**Last Updated:** November 22, 2026

## 1. Introduction

This Privacy Policy explains how Broski, operated by humblemuzzu ("we," "us," or "our"), collects, uses, stores, and protects information when you use the Broski mobile application ("App") and related services. By using the App, you agree to the practices described in this Privacy Policy.

Broski is a mobile application that allows you to remotely control AI coding agents running on your personal computer from your mobile device. The App connects to a bridge server you run on your own machine. There is no cloud account, paid subscription, or third-party billing service.

## 2. Information We Collect

### 2.1 Account Information

The App does not require an account. There is no Google Sign-In, Apple Sign-In, or cloud user profile.

### 2.2 Subscription and Payment Information

Broski does not sell subscriptions and does not use RevenueCat, Stripe, or App Store / Google Play billing.

### 2.3 Device and Machine Information

When you pair, the App creates its own encryption key pair and gives your computer its public key and a device name, which your computer keeps in its list of paired devices so you can revoke them. Nothing of this is sent to us: Broski runs no servers that hold your data.

We generate these identifiers ourselves. We do not read your hardware serial numbers, UDID, IDFA, or any Apple/Google advertising identifiers.

### 2.4 Data Stored Locally on Your Device Only

The following data is stored exclusively on your mobile device using platform-native encrypted storage and is never transmitted to our servers:

| Data | Storage Method | Purpose |
|------|---------------|---------|
| Pairing data for each paired computer (the computer's public key and fingerprint, local network addresses, relay address and relay token) and this device's encryption key | iOS Keychain / Android Keystore-encrypted storage | Connecting to your computer through Broski Link |
| The inbox's last known rows, seen/unread state, and pinned/muted sessions | Encrypted local storage | Showing your inbox at launch and remembering session preferences |
| Your xAI API key, if you add one for dictation | iOS Keychain / Android Keystore-encrypted storage | Transcribing what you dictate (section 5.7) |
| App settings and preferences (theme, notification preferences, selected agent) | Encrypted local storage | Remembering your preferences |
| Paired computer fingerprints (from the pairing QR code) | Encrypted local storage | Verifying that the end-to-end encrypted connection reaches the computer you paired with |

### 2.5 Data We Do NOT Collect

We want to be explicit about what we never collect, access, or store on our servers:

- **Your source code or files** -- Code stays on your computer; the App acts as a remote interface only
- **Your AI chat conversations or prompts** -- These flow directly between your phone and your computer
- **Your AI session data or history** -- Stored only on your local machine
- **Your API keys or AI provider credentials** -- Configured and stored on your computer only
- **Your location data** -- We never access GPS or location services
- **Your contacts or address book**
- **Your browsing or search history**
- **Health, fitness, or biometric data**
- **Advertising identifiers (IDFA/GAID)** -- We do not use any advertising SDKs
- **Usage analytics or behavioral telemetry** -- We do not use analytics SDKs (no Firebase Analytics, Mixpanel, Amplitude, etc.)
- **Crash reports** -- We do not use crash reporting services (no Crashlytics, Sentry, Bugsnag, etc.)

## 3. How We Use Your Information

We use the information we collect solely for the following purposes:

| Purpose | Legal Basis (GDPR) |
|---------|-------------------|
| Providing customer support when you contact us | Performance of contract |
| Complying with legal obligations | Legal obligation |

**We do not use your data for:**
- Advertising or marketing to third parties
- Profiling or automated decision-making
- Selling or renting to data brokers or any third party
- Training AI models
- Behavioral tracking or analytics

## 4. How Your Data Flows

```
Your Phone (Broski App)
        |
        | Broski Link: end-to-end encrypted connection
        | (directly over the local network, or through a relay
        | that only forwards encrypted data)
        | One-time QR pairing secret + pinned computer fingerprint
        ↓
Your Computer (Bridge Server)
        |
        | Local process communication
        ↓
AI Agents (Claude Code, Pi)
        |
        | API calls using YOUR configured keys
        ↓
AI Providers (Anthropic, OpenAI, Google, etc.)
```

Your code, conversations, and AI interactions flow directly between your devices and the AI providers you configure. Broski does not operate a cloud account or billing backend.

## 5. Third-Party Services and Data Processors

### 5.1 Authentication Providers

None. The App does not use Google Sign-In, Apple Sign-In, or a cloud user account.

### 5.2 Subscription Management

None. Broski does not sell subscriptions.

### 5.3 Cloud Infrastructure

None. There is no Broski cloud backend.

### 5.4 AI Service Providers (User-Configured)

When you use Broski to interact with AI coding agents, your prompts and code context are sent to AI providers that **you configure on your own computer**. This data flows directly from your computer to these providers -- it does not pass through our servers. You are responsible for reviewing their privacy policies:

- [Anthropic (Claude) Privacy Policy](https://www.anthropic.com/privacy)
- [OpenAI Privacy Policy](https://openai.com/privacy)
- [Google (Gemini) Privacy Policy](https://policies.google.com/privacy)

### 5.5 Relay (When Your Phone Is Not on Your Computer's Network)

When your phone cannot reach your computer directly on the local network, the connection goes through a relay. Everything between your phone and your computer is encrypted end to end, so the relay cannot read your prompts, code, files or conversations. The relay can see connection metadata: phone and computer identifiers, connection timing and message sizes, and, if you enable notifications, notification metadata (platform, push token, notification type and size). Notification contents are encrypted and are decrypted on your phone.

### 5.6 Dictation (xAI)

When you dictate into the composer, the App records audio only while you use the microphone. If you have added your own xAI API key, the App sends the recording, with a short list of words from your session (such as file and code names) to help spelling, directly to xAI's speech-to-text service under your key; it does not pass through your computer or our servers. Without a key, your phone's own speech recognizer transcribes it, under Apple's or Google's terms. See the [xAI Privacy Policy](https://x.ai/legal/privacy-policy).

### 5.7 Services We Do NOT Use

| Service Category | Used? |
|-----------------|-------|
| Analytics (Firebase, Mixpanel, Amplitude, etc.) | No |
| Crash reporting (Crashlytics, Sentry, Bugsnag, etc.) | No |
| Advertising networks | No |
| Data brokers | No |
| User tracking / behavioral analytics | No |
| Push notification analytics | No |

## 6. Data Storage and Security

### 6.1 On Your Mobile Device

All locally stored data uses platform-native encrypted storage:
- **iOS:** Keychain Services with hardware-backed encryption
- **Android:** Android Keystore with AES-256-GCM encryption

### 6.2 Network Security

| Connection Type | Encryption | Exposure |
|----------------|-----------|----------|
| App to xAI (dictation, with your own key) | TLS (HTTPS) | Internet |
| App to your computer (local network) | Noise end-to-end encryption (hybrid X25519 + ML-KEM-768) | Local network only |
| App to your computer (through the relay) | Noise end-to-end encryption, carried over TLS to the relay | Internet; the relay sees identifiers, timing and sizes only, never content |

## 7. Data Retention

| Data | Retention Period | Deletion Trigger |
|------|-----------------|-----------------|
| Paired device list (on your computer) | Until you revoke the device | Revoking the device on your computer |
| Locally stored data (on your device) | Until you forget the computer or uninstall | Forgetting the computer, or uninstalling the App |

## 8. Your Rights and Choices

### 8.1 All Users

You have the right to:

- **Forget a computer:** Machines > Forget removes its pairing data from your device; revoking the device on your computer removes it there
- **Uninstall:** Remove the App and all locally stored data from your device

### 8.2 European Users (GDPR)

If you are located in the European Economic Area (EEA), United Kingdom, or Switzerland, you have additional rights under the General Data Protection Regulation:

| Right | How to Exercise |
|-------|----------------|
| Right to access | Email us |
| Right to rectification | Email us to correct inaccurate data |
| Right to erasure ("right to be forgotten") | Uninstall the App, or forget each computer in Machines |
| Right to data portability | Email us for a copy of your data |
| Right to restrict processing | Email us |
| Right to object | Email us |
| Right to withdraw consent | Uninstall the App at any time |
| Right to lodge a complaint | Contact your local data protection authority |

Our legal bases for processing are: performance of contract (providing the local app) and legitimate interest (security). There is no cloud account processor.

### 8.3 California Users (CCPA/CPRA)

If you are a California resident, you have the right to:

- **Know** what personal information we collect and how we use it (described in this policy)
- **Delete** your locally stored data (Settings > Start Over, Machines > Forget, or uninstalling the App)
- **Opt-out of sale** of personal information -- **We do not sell your personal information**
- **Non-discrimination** -- We will not discriminate against you for exercising your rights

**Categories of personal information collected in the last 12 months:**

| Category | Collected | Sold | Disclosed for Business Purpose |
|----------|----------|------|-------------------------------|
| Identifiers (email, device ID) | No | No | No |
| Commercial information (subscription status) | No | No | No |
| Internet or network activity | No | No | No |
| Geolocation data | No | No | No |
| Biometric information | No | No | No |
| Sensory data | No | No | No |
| Professional or employment info | No | No | No |

### 8.4 Other Jurisdictions

We aim to comply with applicable data protection laws worldwide. If your jurisdiction grants additional rights not listed above, please contact us and we will accommodate your request to the extent required by law.

## 9. Children's Privacy

Broski is a professional developer tool rated 17+ on the App Store. It is not intended for use by children under the age of 17. We do not knowingly collect personal information from children under 13 (or the applicable age of consent in your jurisdiction). If we learn that we have collected personal information from a child under 13, we will delete that information promptly. If you believe a child has provided us with personal information, please contact us immediately.

## 10. App Permissions

The App requests the following device permissions:

| Permission | Purpose | Data Collected |
|-----------|---------|---------------|
| Camera | Scanning QR codes for bridge connection setup; attaching photos to AI conversations | None sent to our servers -- photos go to your bridge only |
| Photo Library | Attaching images to AI conversations | None sent to our servers -- images go to your bridge only |
| Microphone & Speech Recognition | Dictating prompts into the composer (transcribed on-device, or via xAI with your own API key) | Audio is never sent to our servers |
| Local Network (iOS) | Connecting directly to your computer on the local network | None |
| Notifications | Alerting you when AI tasks complete | None |

All permissions are optional and requested at the time of use. The App functions without camera or photo library access (you can enter connection details manually).

## 11. Changes to This Privacy Policy

We may update this Privacy Policy from time to time. When we make material changes, we will:

- Update the "Last Updated" date at the top of this policy
- Provide notice through the App (in-app notification or prompt)
- If required by law, obtain your consent before the changes take effect

Your continued use of the App after changes are posted constitutes your acceptance of the updated Privacy Policy. We encourage you to review this policy periodically.

## 12. App Store Privacy Nutrition Label

Based on Apple's App Privacy requirements:

**Data Linked to You:**
- None

**Data Not Linked to You:**
- None

**Data Used to Track You:**
- None -- We do not track users across third-party apps or websites

**Data Not Collected:**
- Location, Contacts, Health & Fitness, Browsing History, Search History, Financial Info, Sensitive Info, User Content, Diagnostics, Advertising Data

## 13. Contact Us

If you have questions, concerns, or requests regarding this Privacy Policy or your personal data, please contact us:

**Email:** broskiappp@gmail.com

**Response time:** We will acknowledge your request within 48 hours and provide a substantive response within 30 days (or sooner if required by applicable law).

For security issues, please open a private security advisory on the [GitHub repository](https://github.com/humblemuzzu/broski/security) or email broskiappp@gmail.com.
