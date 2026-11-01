import type { Metadata } from "next";
import { Callout, SimpleTable, CardGrid, Card } from "@/components/docs";

export const metadata: Metadata = {
  title: "Security & Privacy - Broski",
  description:
    "How Broski keeps your code, conversations, and data private by design. No cloud servers, no telemetry, no data collection.",
};

export default function SecurityPage() {
  return (
    <article className="max-w-3xl">
      <h1 id="security" className="text-4xl font-bold mb-3">
        Security &amp; Privacy
      </h1>
      <p className="text-xl text-muted-foreground mb-8">
        Your code never leaves your machine. That&apos;s not a policy &mdash;
        it&apos;s the architecture.
      </p>

      {/* TL;DR */}
      <section className="mb-12">
        <div className="bg-muted/30 border border-border rounded-lg p-5">
          <h2
            id="tldr"
            className="text-lg font-semibold mb-3"
          >
            The Short Version
          </h2>
          <ul className="space-y-2 text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5 shrink-0">&#10003;</span>
              <span>
                <strong className="text-foreground">No cloud servers.</strong>{" "}
                Broski connects your phone directly to your own computer. We
                don&apos;t operate servers that touch your code.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5 shrink-0">&#10003;</span>
              <span>
                <strong className="text-foreground">No telemetry.</strong> Zero
                analytics libraries. No Firebase, no Mixpanel, no Sentry, no
                Amplitude. We literally cannot see what you do.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5 shrink-0">&#10003;</span>
              <span>
                <strong className="text-foreground">No data collection.</strong>{" "}
                Your conversations, code, files, and terminal output stay
                between your phone and your system. Period.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5 shrink-0">&#10003;</span>
              <span>
                <strong className="text-foreground">
                  Encrypted everything.
                </strong>{" "}
                Noise end-to-end encryption between your phone and your Mac,
                on the local network and through a relay.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5 shrink-0">&#10003;</span>
              <span>
                <strong className="text-foreground">You run the server.</strong>{" "}
                The bridge runs on your machine, in your terminal. You can
                inspect every line of traffic.
              </span>
            </li>
          </ul>
        </div>
      </section>

      {/* Architecture */}
      <section className="mb-12">
        <h2 id="architecture" className="text-2xl font-semibold mb-4">
          Zero-Cloud Architecture
        </h2>
        <p className="text-muted-foreground mb-4">
          Unlike cloud-based coding tools that route your code through remote
          servers, Broski is peer-to-peer. Your phone talks directly to your
          computer &mdash; nothing in between.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 py-6 px-4 bg-muted/30 rounded-lg border border-border mb-6">
          <div className="text-center">
            <div className="px-4 py-3 bg-primary/10 border border-primary/30 rounded-lg">
              <div className="font-semibold text-sm">Your Phone</div>
              <div className="text-xs text-muted-foreground">Broski App</div>
            </div>
          </div>
          <div className="text-center">
            <div className="text-muted-foreground text-lg">&#10230;</div>
            <div className="text-[10px] text-muted-foreground">Encrypted</div>
          </div>
          <div className="text-center">
            <div className="px-4 py-3 bg-muted border border-border rounded-lg">
              <div className="font-semibold text-sm">Your System</div>
              <div className="text-xs text-muted-foreground">Bridge Server</div>
            </div>
          </div>
          <div className="text-center">
            <div className="text-muted-foreground text-lg">&#10230;</div>
            <div className="text-[10px] text-muted-foreground">Local</div>
          </div>
          <div className="text-center">
            <div className="px-4 py-3 bg-muted border border-border rounded-lg">
              <div className="font-semibold text-sm">AI Agent</div>
              <div className="text-xs text-muted-foreground">
                On Your System
              </div>
            </div>
          </div>
        </div>

        <p className="text-muted-foreground mb-4">
          The bridge server runs in your terminal on your own machine. It
          translates between your phone and the AI agent (Claude Code or Pi)
          running locally. At no point does any of this traffic pass
          through a Broski-operated server.
        </p>

        <Callout type="info" title="What about the AI itself?">
          When you chat with the AI, your prompts are sent to the AI provider
          (Anthropic, OpenAI, etc.) by the agent running on your system &mdash;
          exactly the same as if you were using the agent directly in your
          terminal. Broski doesn&apos;t add, modify, or intercept anything in that
          pipeline.
        </Callout>
      </section>

      {/* What stays where */}
      <section className="mb-12">
        <h2 id="data-stays-local" className="text-2xl font-semibold mb-4">
          Where Your Data Lives
        </h2>
        <p className="text-muted-foreground mb-6">
          Here&apos;s exactly what goes where. No vague language, no footnotes.
        </p>

        <div className="space-y-4">
          <div className="border border-green-500/30 bg-green-500/5 rounded-lg p-5">
            <h3 className="font-semibold mb-3 text-green-400">
              Stays on Your Computer (never leaves)
            </h3>
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li className="flex items-start gap-2">
                <span className="text-green-500 shrink-0">&#8226;</span>
                Your source code and project files
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 shrink-0">&#8226;</span>
                Session history and AI conversation logs
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 shrink-0">&#8226;</span>
                Terminal output and command history
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 shrink-0">&#8226;</span>
                Your API keys and credentials (in the OS keychain (macOS Keychain, Windows Credential Manager, or Linux keyring) or local config
                files)
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 shrink-0">&#8226;</span>
                Broski Link identity key and the list of paired phones
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 shrink-0">&#8226;</span>
                The local hook token and loopback TLS certificate (self-signed, generated locally)
              </li>
            </ul>
          </div>

          <div className="border border-blue-500/30 bg-blue-500/5 rounded-lg p-5">
            <h3 className="font-semibold mb-3 text-blue-400">
              Stays on Your Phone (encrypted on-device)
            </h3>
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li className="flex items-start gap-2">
                <span className="text-blue-500 shrink-0">&#8226;</span>
                Pairing data and encryption keys (in iOS Keychain / Android
                EncryptedSharedPreferences)
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 shrink-0">&#8226;</span>
                Cached sessions and messages (for offline viewing)
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 shrink-0">&#8226;</span>
                UI preferences (themes, settings)
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 shrink-0">&#8226;</span>
                Voice API keys if you configure voice input (stored encrypted,
                sent only to provider you chose)
              </li>
            </ul>
          </div>

          <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-5">
            <h3 className="font-semibold mb-3 text-amber-400">
              Sent to AI Providers (same as terminal usage)
            </h3>
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li className="flex items-start gap-2">
                <span className="text-amber-500 shrink-0">&#8226;</span>
                Your prompts and questions to the AI
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 shrink-0">&#8226;</span>
                Code snippets the AI reads (only what the agent requests)
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 shrink-0">&#8226;</span>
                File contents needed for context
              </li>
            </ul>
            <p className="text-xs text-muted-foreground mt-3">
              This is handled by the AI agent (Claude Code, Pi) on
              your system &mdash; exactly the same data that would be sent if you
              used the agent directly in your terminal. Broski doesn&apos;t add
              anything extra.
            </p>
          </div>

          <div className="border border-red-500/30 bg-red-500/5 rounded-lg p-5">
            <h3 className="font-semibold mb-3 text-red-400">
              What Broski Never Sees
            </h3>
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li className="flex items-start gap-2">
                <span className="text-red-500 shrink-0">&#8226;</span>
                Your source code or project files
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-500 shrink-0">&#8226;</span>
                Your conversations with AI
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-500 shrink-0">&#8226;</span>
                Your API keys or credentials
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-500 shrink-0">&#8226;</span>
                Your file system or network traffic
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-500 shrink-0">&#8226;</span>
                Any usage data, analytics, or behavioral metrics
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Encryption */}
      <section className="mb-12">
        <h2 id="encryption" className="text-2xl font-semibold mb-4">
          Encryption
        </h2>
        <p className="text-muted-foreground mb-6">
          Every connection between your phone and your computer is end-to-end
          encrypted, whichever route it takes:
        </p>

        <SimpleTable
          headers={["Route", "Encryption", "How It Works"]}
          rows={[
            [
              "Local network",
              "Noise end-to-end",
              "Hybrid X25519 + ML-KEM-768 handshake with your Mac, pinned to the fingerprint from the QR code.",
            ],
            [
              "Relay",
              "Noise end-to-end",
              "The same Noise session runs inside the relay connection. The relay forwards ciphertext and cannot decrypt it.",
            ],
          ]}
        />

        <h3 id="machine-fingerprint" className="text-lg font-medium mb-3 mt-8">
          Machine Fingerprint
        </h3>
        <p className="text-muted-foreground mb-4">
          When you scan the QR code, your phone learns your Mac&apos;s
          fingerprint. On pairing the phone checks that the machine it reaches
          matches that fingerprint, and every later connection is made to that
          same machine. If someone tries to intercept the connection, the
          handshake fails and the app refuses to connect.
        </p>
        <p className="text-muted-foreground">
          This means even on a compromised WiFi network (coffee shop, hotel,
          airport), or through a relay you do not control, your connection is
          secure.
        </p>
      </section>

      {/* Authentication */}
      <section className="mb-12">
        <h2 id="authentication" className="text-2xl font-semibold mb-4">
          Pairing &amp; Authentication
        </h2>
        <p className="text-muted-foreground mb-4">
          Only phones you paired can connect. Here&apos;s how it works:
        </p>

        <div className="space-y-4">
          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-medium mb-2">One-Time Pairing Secret</h3>
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li>
                &#8226; The pairing QR carries a 32-byte random secret and your
                Mac&apos;s fingerprint
              </li>
              <li>&#8226; It expires after 10 minutes</li>
              <li>&#8226; It works once; the next pairing needs a new QR</li>
              <li>
                &#8226; A wrong secret fails the handshake before any data is
                exchanged
              </li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-medium mb-2">Per-Device Keys</h3>
            <p className="text-sm text-muted-foreground">
              Each phone has its own key, created on the phone. Your Mac keeps
              the list of paired phones (see{" "}
              <code className="px-1 py-0.5 bg-muted rounded text-xs">
                broski-link devices
              </code>
              ) and only accepts those. Remove a phone at any time with{" "}
              <code className="px-1 py-0.5 bg-muted rounded text-xs">
                broski-link revoke
              </code>
              .
            </p>
          </div>
        </div>

        <Callout type="warning" title="Protect your QR code">
          The QR code contains the one-time pairing secret. Don&apos;t share a
          screenshot of it. If you think someone saw it before you used it, run{" "}
          <code className="px-1 py-0.5 bg-muted rounded text-xs">
            broski-link pair
          </code>{" "}
          again: a new QR replaces the old one.
        </Callout>
      </section>

      {/* Filesystem Security */}
      <section className="mb-12">
        <h2 id="filesystem" className="text-2xl font-semibold mb-4">
          Filesystem Protection
        </h2>
        <p className="text-muted-foreground mb-4">
          The bridge restricts which files and directories can be accessed
          through the mobile app:
        </p>

        <ul className="text-muted-foreground space-y-2 mb-4">
          <li className="flex items-start gap-2">
            <span className="text-foreground font-bold shrink-0">&#8226;</span>
            <span>
              <strong className="text-foreground">Allowlist-based access</strong>{" "}
              &mdash; Only your home directory and common project paths are
              accessible. Paths outside the allowlist are blocked.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-foreground font-bold shrink-0">&#8226;</span>
            <span>
              <strong className="text-foreground">Symlink protection</strong>{" "}
              &mdash; Symbolic links are resolved and re-checked against the
              allowlist, preventing directory traversal attacks.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-foreground font-bold shrink-0">&#8226;</span>
            <span>
              <strong className="text-foreground">Path validation</strong>{" "}
              &mdash; Null bytes, control characters, and excessively long paths
              are rejected before any file operation.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-foreground font-bold shrink-0">&#8226;</span>
            <span>
              <strong className="text-foreground">Text-only reads</strong>{" "}
              &mdash; The file browser only serves text content. Binary files
              are blocked.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-foreground font-bold shrink-0">&#8226;</span>
            <span>
              <strong className="text-foreground">Size limits</strong> &mdash;
              Large files are truncated to prevent memory exhaustion.
            </span>
          </li>
        </ul>
      </section>

      {/* No Telemetry */}
      <section className="mb-12">
        <h2 id="no-telemetry" className="text-2xl font-semibold mb-4">
          Zero Telemetry
        </h2>
        <p className="text-muted-foreground mb-4">
          We don&apos;t mean &ldquo;minimal telemetry&rdquo; or &ldquo;anonymous
          analytics.&rdquo; We mean zero. None. The app and bridge contain:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <div className="border border-border/50 rounded-lg p-4 text-center">
            <div className="text-2xl mb-1 text-red-400">&#10007;</div>
            <div className="text-sm font-medium">No Analytics SDK</div>
            <div className="text-xs text-muted-foreground mt-1">
              No Firebase Analytics, no Mixpanel, no Amplitude, no Segment
            </div>
          </div>
          <div className="border border-border/50 rounded-lg p-4 text-center">
            <div className="text-2xl mb-1 text-red-400">&#10007;</div>
            <div className="text-sm font-medium">No Crash Reporting</div>
            <div className="text-xs text-muted-foreground mt-1">
              No Sentry, no Bugsnag, no Crashlytics
            </div>
          </div>
          <div className="border border-border/50 rounded-lg p-4 text-center">
            <div className="text-2xl mb-1 text-red-400">&#10007;</div>
            <div className="text-sm font-medium">No Usage Tracking</div>
            <div className="text-xs text-muted-foreground mt-1">
              No screen views, no click events, no session recordings
            </div>
          </div>
          <div className="border border-border/50 rounded-lg p-4 text-center">
            <div className="text-2xl mb-1 text-red-400">&#10007;</div>
            <div className="text-sm font-medium">No Advertising</div>
            <div className="text-xs text-muted-foreground mt-1">
              No ad networks, no tracking pixels, no attribution
            </div>
          </div>
        </div>

        <p className="text-muted-foreground">
          If the app crashes, we don&apos;t know about it unless you email us.
          If you use a feature 1000 times a day, we have no idea. This is by
          design &mdash; we built a developer tool, not a data product.
        </p>
      </section>

      {/* Third-party services */}
      <section className="mb-12">
        <h2 id="third-party" className="text-2xl font-semibold mb-4">
          Third-Party Services
        </h2>
        <p className="text-muted-foreground mb-6">
          Broski uses exactly two external services. Here&apos;s what they do
          and what they can see:
        </p>

        <div className="space-y-4">
          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">
              Authentication (Google / Apple Sign-In)
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              Standard OAuth 2.0 identity verification. We use this to know who
              you are for subscription management.
            </p>
            <SimpleTable
              headers={["Receives", "Does NOT Receive"]}
              rows={[
                ["Your name and email", "Your code or projects"],
                ["OAuth identity token", "Your conversations"],
                ["", "Your API keys"],
                ["", "Any app usage data"],
              ]}
            />
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">
              No subscription backend
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              Broski is free and open source. There is no RevenueCat, Stripe,
              or cloud billing service.
            </p>
          </div>
        </div>

        <Callout type="info" title="Optional: Voice Input">
          If you enable voice-to-text in settings, audio is sent to the
          provider you choose (Groq or OpenAI) using your own API key. This is
          entirely opt-in. Voice is not enabled by default and no audio data
          is ever sent to Broski.
        </Callout>
      </section>

      {/* On-Device Storage */}
      <section className="mb-12">
        <h2 id="storage" className="text-2xl font-semibold mb-4">
          On-Device Storage Security
        </h2>
        <p className="text-muted-foreground mb-4">
          Sensitive data on your phone is stored using platform-native encrypted
          storage:
        </p>

        <SimpleTable
          headers={["Platform", "Storage Method", "Encryption"]}
          rows={[
            [
              "iOS",
              "Keychain Services",
              "Hardware-backed (Secure Enclave on supported devices)",
            ],
            [
              "Android",
              "EncryptedSharedPreferences",
              "AES-256 (Android Keystore system)",
            ],
          ]}
        />

        <p className="text-muted-foreground mt-4 mb-4">
          Your pairing data, cached credentials, and voice API keys are
          stored in this encrypted storage. UI preferences and cached session
          data also use this encrypted layer.
        </p>

        <p className="text-muted-foreground">
          On your system, the bridge stores its local hook token and loopback TLS
          certificate in{" "}
          <code className="px-1 py-0.5 bg-muted rounded text-xs">
            ~/.broski/
          </code>
          , and Broski Link stores its identity key and the list of paired
          phones in{" "}
          <code className="px-1 py-0.5 bg-muted rounded text-xs">
            ~/.broski/link/
          </code>
          , all with restricted file permissions (owner read/write only). Your AI
          agent&apos;s credentials stay in their own secure storage (the OS keychain (macOS
          Keychain or Linux keyring) for Claude Code, <code>~/.pi/agent/auth.json</code> for Pi).
        </p>
      </section>

      {/* Network Security Deep Dive */}
      <section className="mb-12">
        <h2 id="network" className="text-2xl font-semibold mb-4">
          Network Security
        </h2>

        <h3 id="local-wifi" className="text-lg font-medium mb-3 mt-6">
          Local Network
        </h3>
        <p className="text-muted-foreground mb-4">
          On the same network, your phone connects straight to{" "}
          <code className="px-1 py-0.5 bg-muted rounded text-xs">broski-link</code>{" "}
          on your Mac. The connection is a Noise handshake pinned to the
          fingerprint from the QR code, so someone sniffing or spoofing WiFi
          traffic sees only encrypted data and cannot impersonate your Mac.
        </p>

        <h3 id="relay" className="text-lg font-medium mb-3 mt-6">
          Relay
        </h3>
        <p className="text-muted-foreground mb-4">
          Away from home, your phone and Mac both connect out to a relay. The
          relay forwards opaque encrypted frames. It sees ids, connection
          timing, message sizes and notification metadata, and it never has the
          keys to read your traffic. Nothing is exposed publicly and no inbound
          port needs to be opened.
        </p>

        <h3
          id="no-plaintext"
          className="text-lg font-medium mb-3 mt-6"
        >
          The Bridge Is Not on the Network
        </h3>
        <p className="text-muted-foreground">
          The bridge listens on a local Unix socket for{" "}
          <code className="px-1 py-0.5 bg-muted rounded text-xs">broski-link</code>{" "}
          and on{" "}
          <code className="px-1 py-0.5 bg-muted rounded text-xs">
            127.0.0.1
          </code>{" "}
          (loopback only, TLS with a local bearer token) for agent hooks, the
          dashboard and dev-server previews. There&apos;s no configuration that
          exposes the bridge to your LAN.
        </p>
      </section>

      {/* Input Validation */}
      <section className="mb-12">
        <h2 id="input-validation" className="text-2xl font-semibold mb-4">
          Input Validation &amp; Hardening
        </h2>
        <p className="text-muted-foreground mb-4">
          The bridge validates every message from the mobile app before
          processing:
        </p>
        <ul className="text-muted-foreground space-y-2">
          <li className="flex items-start gap-2">
            <span className="text-foreground font-bold shrink-0">&#8226;</span>
            <span>
              <strong className="text-foreground">
                Prototype pollution protection
              </strong>{" "}
              &mdash; All incoming payloads are checked for prototype poisoning
              keys and rejected if found.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-foreground font-bold shrink-0">&#8226;</span>
            <span>
              <strong className="text-foreground">Type enforcement</strong>{" "}
              &mdash; String values are validated to be actual strings before
              use.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-foreground font-bold shrink-0">&#8226;</span>
            <span>
              <strong className="text-foreground">Message size limits</strong>{" "}
              &mdash; Large payloads are rejected to prevent resource
              exhaustion.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-foreground font-bold shrink-0">&#8226;</span>
            <span>
              <strong className="text-foreground">Log redaction</strong> &mdash;
              Tokens, passwords, API keys, and secrets are automatically
              redacted from bridge logs.
            </span>
          </li>
        </ul>
      </section>

      {/* Permission System */}
      <section className="mb-12">
        <h2 id="permissions" className="text-2xl font-semibold mb-4">
          Permission System
        </h2>
        <p className="text-muted-foreground mb-4">
          When the AI wants to perform a potentially dangerous action (running a
          shell command, editing a file, deleting something), you see the
          request on your phone and explicitly approve or deny it. Nothing
          happens without your consent.
        </p>
        <p className="text-muted-foreground mb-4">
          You can configure permission levels in Settings:
        </p>

        <SimpleTable
          headers={["Preset", "Behavior"]}
          rows={[
            [
              "Ask Everything",
              "Approve every tool call individually (safest)",
            ],
            [
              "Ask Code Changes",
              "Auto-approve reads, ask for writes and commands",
            ],
            [
              "Trust Me",
              "Auto-approve most actions (for experienced users)",
            ],
            [
              "Custom",
              "Define your own rules per tool and per path pattern",
            ],
          ]}
        />

        <p className="text-muted-foreground mt-4">
          Permission rules are stored locally on your phone and sent to the
          bridge for enforcement. They&apos;re never uploaded anywhere.
        </p>
      </section>

      {/* Comparison */}
      <section className="mb-12">
        <h2 id="comparison" className="text-2xl font-semibold mb-4">
          How This Compares
        </h2>
        <p className="text-muted-foreground mb-6">
          Most developer tools collect some amount of data. Here&apos;s how
          Broski&apos;s approach is different:
        </p>

        <SimpleTable
          headers={["Aspect", "Typical Dev Tool", "Broski"]}
          rows={[
            [
              "Architecture",
              "Cloud-hosted backend",
              "Peer-to-peer (your devices only)",
            ],
            [
              "Code access",
              "Code passes through vendor servers",
              "Code never leaves your machine",
            ],
            [
              "Analytics",
              "Usage tracking, session recordings",
              "Zero analytics, zero tracking",
            ],
            [
              "Crash reporting",
              "Automatic error reporting",
              "None (email us if something breaks)",
            ],
            [
              "Data storage",
              "Vendor databases",
              "Your device only (encrypted)",
            ],
            [
              "Server trust",
              "Trust the vendor's infrastructure",
              "You run the server yourself",
            ],
          ]}
        />
      </section>

      {/* Verify It Yourself */}
      <section className="mb-12">
        <h2 id="verify" className="text-2xl font-semibold mb-4">
          Verify It Yourself
        </h2>
        <p className="text-muted-foreground mb-4">
          You don&apos;t have to take our word for it. The bridge runs on your
          machine, and you can verify everything:
        </p>
        <ul className="text-muted-foreground space-y-2">
          <li className="flex items-start gap-2">
            <span className="text-foreground font-bold shrink-0">&#8226;</span>
            <span>
              <strong className="text-foreground">
                Inspect network traffic
              </strong>{" "}
              &mdash; Use Wireshark or Charles Proxy. You&apos;ll see encrypted
               WebSocket frames between your phone and your system, and nothing going to
              any Broski endpoint.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-foreground font-bold shrink-0">&#8226;</span>
            <span>
              <strong className="text-foreground">Run the doctor</strong> &mdash;{" "}
              <code className="px-1 py-0.5 bg-muted rounded text-xs">
                broski doctor
              </code>{" "}
              runs 30+ diagnostics including loopback TLS cert validity, hook token
              status, port bindings, and daemon health.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-foreground font-bold shrink-0">&#8226;</span>
            <span>
              <strong className="text-foreground">Check DNS queries</strong>{" "}
              &mdash; Monitor outgoing DNS. <code className="px-1 py-0.5 bg-muted rounded text-xs">broski-link</code> only
              connects to the relay you configured, if any.
            </span>
          </li>
        </ul>
      </section>

      {/* FAQ-style quick answers */}
      <section className="mb-12">
        <h2 id="quick-answers" className="text-2xl font-semibold mb-6">
          Quick Answers
        </h2>
        <div className="space-y-4">
          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">
              &ldquo;Can Broski read my code?&rdquo;
            </h3>
            <p className="text-muted-foreground">
              Broski the company? No. The Broski app on your phone? Only what
              you explicitly open in the file browser or what the AI agent
              sends during a session. All of this stays between your phone and
              your system.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">
              &ldquo;What if someone finds my bridge on the network?&rdquo;
            </h3>
            <p className="text-muted-foreground">
              Nothing, because the bridge is not on the network. It listens on
              your machine&apos;s loopback interface and a local socket only.
              The only network-facing process is{" "}
              <code className="px-1 py-0.5 bg-muted rounded text-xs">
                broski-link
              </code>
              , and it only completes an encrypted handshake with phones you
              paired. An unpaired device cannot get past it.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">
              &ldquo;Do you sell data?&rdquo;
            </h3>
            <p className="text-muted-foreground">
              We don&apos;t have data to sell. We don&apos;t collect analytics,
              we don&apos;t track usage, we don&apos;t store conversations.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">
              &ldquo;Is there a Broski subscription?&rdquo;
            </h3>
            <p className="text-muted-foreground">
              No. Broski is free and open source. Pairing data stays on your
              phone and your machine.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">
              &ldquo;How do I delete everything?&rdquo;
            </h3>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Phone:</strong> Settings
              &gt; Clear Cache removes all cached data. Uninstalling removes
              everything.
              <br />
              <strong className="text-foreground">System:</strong> Delete{" "}
              <code className="px-1 py-0.5 bg-muted rounded text-xs">
                ~/.broski
              </code>{" "}
              to remove all bridge data (hook token, certificates, config, link state).
              <br />
              That&apos;s it. There&apos;s nothing on our end to delete because
              we never had it.
            </p>
          </div>
        </div>
      </section>

      {/* Related */}
      <section className="mt-12 pt-8 border-t border-border/50">
        <h2 id="related" className="text-lg font-semibold mb-4">
          Related
        </h2>
        <CardGrid>
          <Card
            href="/legal/privacy"
            title="Privacy Policy"
            description="Full legal privacy policy"
          />
          <Card
            href="/docs/bridge/remote-access"
            title="Remote Access"
            description="Direct and relay connections"
          />
          <Card
            href="/docs/guides/approve-commands"
            title="Approving Commands"
            description="How the permission system works"
          />
          <Card
            href="/docs/faq#privacy"
            title="FAQ"
            description="Quick privacy & security answers"
          />
        </CardGrid>
      </section>
    </article>
  );
}
