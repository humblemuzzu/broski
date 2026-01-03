# Privacy Policy

**Effective Date:** January 2, 2026  
**Last Updated:** January 2, 2026

## Introduction

Broski ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how our mobile application ("Broski" or the "App") collects, uses, and safeguards information when you use our service.

Broski is a remote control application that allows you to manage AI coding agents (OpenCode and Claude Code) running on your personal computer from your mobile device. The App operates as a peer-to-peer connection between your phone and your computer—we do not operate servers that process or store your data.

## Information We Do NOT Collect

We want to be clear about what we do NOT do:

- **No user accounts or registration required**
- **No personal information collection** (name, email, phone number, address)
- **No analytics or usage tracking**
- **No advertising or marketing data collection**
- **No location data collection**
- **No contact list access**
- **No third-party analytics SDKs** (no Firebase, Crashlytics, Mixpanel, etc.)
- **No data sold or shared with third parties**
- **No cloud servers storing your data**

## Information Collected and Stored Locally

The following information is stored **only on your device** using encrypted secure storage:

### Device Identifier
- **What:** A randomly generated UUID (not a hardware identifier)
- **Why:** To identify your device when connecting to your bridge server for multi-device support
- **Storage:** Encrypted local storage on your device only

### Connection Information
- **What:** IP address, port, and authentication token of your bridge server
- **Why:** To connect to your personal bridge server running on your computer
- **Storage:** Encrypted local storage on your device only

### User Preferences
- **What:** App settings (theme, notification preferences, selected AI backend)
- **Why:** To remember your preferences between app sessions
- **Storage:** Encrypted local storage on your device only

### Cached Session Data
- **What:** Recent chat sessions and messages for offline viewing
- **Why:** To allow you to view past conversations without an active connection
- **Storage:** Encrypted local storage on your device only
- **Retention:** Limited to most recent 50 messages per session

## Information Transmitted

When you use Broski, the following data is transmitted **directly to your own computer** (not to our servers):

### Chat Messages
- Text prompts you send to AI agents
- AI responses received from your computer
- These transmissions occur between your phone and your personal computer only

### File Attachments
- Images you choose to attach to conversations
- These are sent directly to your bridge server on your computer

### Device Information
- Device ID, platform type (iOS/Android), and generic device name
- Sent to your bridge server for multi-device management

## How Data Flows

```
Your Phone (Broski App)
        ↓↑
    [Local WiFi or Tailscale VPN]
        ↓↑
Your Computer (Bridge Server)
        ↓↑
AI Services (configured by you)
```

**Important:** All communication occurs directly between your devices. We do not have access to, and cannot see, any of your conversations, files, or data.

## Third-Party Services

### AI Service Providers
When you use Broski to interact with AI coding agents, your prompts and conversations are processed by AI services **that you configure**, such as:
- Anthropic (Claude)
- OpenAI
- Google (Gemini)
- Other providers you configure

These services have their own privacy policies. We recommend reviewing:
- [Anthropic Privacy Policy](https://www.anthropic.com/privacy)
- [OpenAI Privacy Policy](https://openai.com/privacy)

### Tailscale (Optional)
If you choose to use Tailscale for remote access, Tailscale's services are subject to their privacy policy:
- [Tailscale Privacy Policy](https://tailscale.com/privacy-policy)

### No Third-Party Analytics
We do not use any third-party analytics, crash reporting, or advertising services in the App.

## Permissions

The App requests the following permissions:

### Camera (iOS and Android)
- **Purpose:** To scan QR codes for easy connection setup and to take photos for AI conversations
- **Data collected:** None—photos are processed locally or sent only to your bridge server

### Photo Library (iOS and Android)
- **Purpose:** To attach images from your photo library to AI conversations
- **Data collected:** None—selected images are sent only to your bridge server

### Local Network (iOS)
- **Purpose:** To discover and connect to your bridge server on your local WiFi network
- **Data collected:** None

### Notifications (iOS and Android)
- **Purpose:** To alert you when background AI tasks complete
- **Data collected:** None

## Data Security

### Local Storage
All data stored on your device uses platform-native encrypted storage:
- **iOS:** iOS Keychain with hardware encryption
- **Android:** EncryptedSharedPreferences with AES-256 encryption

### Network Communication
- Local network connections use your home/office network security
- Remote connections via Tailscale use WireGuard encryption (end-to-end)
- HTTPS/WSS is supported for additional transport security

### Authentication
- Connection to your bridge server requires a cryptographically random authentication token
- Tokens are generated locally and never transmitted to external servers

## Data Retention and Deletion

### On Your Device
- All locally stored data can be deleted by:
  - Uninstalling the App
  - Clearing App storage in device settings
  - Using the "Disconnect" feature in the App

### On Your Computer
- Session data on your bridge server is under your complete control
- You can delete sessions through the App or directly on your computer

## Children's Privacy

Broski is a professional developer tool intended for users aged 17 and older. We do not knowingly collect information from children under 13. If you believe a child has provided information through the App, please contact us.

## Your Rights

### For All Users
You have the right to:
- Access all data stored locally on your device
- Delete all data by uninstalling the App or clearing storage
- Control what data is transmitted by configuring your bridge server

### For European Users (GDPR)
You have additional rights including:
- Right to access your personal data
- Right to rectification of inaccurate data
- Right to erasure ("right to be forgotten")
- Right to data portability
- Right to object to processing

Since all data is stored locally on your device and your own computer, you have complete control over your data without needing to contact us.

### For California Users (CCPA/CPRA)
You have the right to:
- Know what personal information is collected
- Delete personal information
- Opt-out of the sale of personal information

**We do not sell your personal information.** Since we don't collect personal information on our servers, there is nothing to sell.

## International Data Transfers

Broski does not transfer your data internationally. All data remains:
- On your mobile device, or
- On your personal computer, or
- With AI service providers you configure (subject to their policies)

## Changes to This Policy

We may update this Privacy Policy from time to time. We will notify you of any changes by:
- Updating the "Last Updated" date at the top
- Posting the new Privacy Policy in the App

We encourage you to review this Privacy Policy periodically.

## Open Source

Broski is open source software. You can review our code to verify our privacy practices:
- [GitHub Repository](https://github.com/your-username/broski)

## Contact Us

If you have questions about this Privacy Policy, please contact us at:

**Email:** privacy@broskiapp.com

---

## App Store Privacy Nutrition Label Summary

Based on Apple's privacy requirements, here is our disclosure:

### Data Not Collected
Broski does not collect any of the following data types:
- Contact Info (name, email, phone, address)
- Health & Fitness
- Financial Info
- Location
- Sensitive Info
- Contacts
- User Content (stored on your device only)
- Browsing History
- Search History
- Identifiers (no advertising ID)
- Purchases
- Usage Data
- Diagnostics

### Data Linked to You
None—we do not collect data that is linked to your identity.

### Data Used to Track You
None—we do not track users across apps or websites.
