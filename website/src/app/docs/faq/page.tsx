import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";

export const metadata: Metadata = {
  title: "FAQ - Broski",
  description: "Frequently asked questions about Broski",
};

export default function FAQPage() {
  return (
    <article className="max-w-3xl">
      <h1 className="text-4xl font-bold mb-4">Frequently Asked Questions</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Quick answers to common questions about Broski.
      </p>

      {/* General */}
      <section className="mb-12">
        <h2 id="general" className="text-2xl font-semibold mb-6">General</h2>
        
        <div className="space-y-6">
          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">What is Broski?</h3>
            <p className="text-muted-foreground">
              Broski is a mobile companion app that turns your phone into a remote control for AI coding agents. 
              It connects to Claude Code, OpenCode, Codex, or Pi running on your system, letting you chat with AI, 
              view code changes, and approve actions from anywhere.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">How much does Broski cost?</h3>
            <p className="text-muted-foreground">
              Broski requires a subscription. The app is free to download, but a subscription is
              required to use it. You&apos;ll also need your own AI provider subscription
              (Claude Pro, OpenAI API key, etc.) configured in your AI backend &mdash; Broski doesn&apos;t handle AI authentication.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">What platforms does Broski support?</h3>
            <p className="text-muted-foreground mb-3">
              <strong className="text-foreground">Mobile:</strong> iOS 15+ and Android 8+
            </p>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Bridge Server:</strong> macOS 12+, Windows 10+ (WSL2), Linux (Ubuntu 20.04+)
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Do I need a computer to use Broski?</h3>
            <p className="text-muted-foreground">
              Yes. Broski is a companion app - the AI coding agent runs on your computer, and Broski 
              provides a mobile interface to interact with it. Your computer needs to be running 
              the bridge server for Broski to work.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">How does Broski work?</h3>
            <p className="text-muted-foreground mb-3">
              Broski uses a three-part architecture:
            </p>
            <ol className="text-muted-foreground space-y-1 list-decimal ml-4">
              <li><strong className="text-foreground">Phone App</strong> - Displays UI, captures input</li>
              <li><strong className="text-foreground">Bridge Server</strong> - Runs on your system, translates messages</li>
              <li><strong className="text-foreground">AI Backend</strong> - Does reasoning, executes tools</li>
            </ol>
          </div>
        </div>
      </section>

      {/* Setup */}
      <section className="mb-12">
        <h2 id="setup" className="text-2xl font-semibold mb-6">Setup &amp; Installation</h2>
        
        <div className="space-y-6">
          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">What do I need to get started?</h3>
            <ul className="text-muted-foreground space-y-2">
              <li>&#8226; A Mac or Linux machine</li>
              <li>&#8226; Broski bridge installed on your computer</li>
              <li>&#8226; Claude Code, OpenCode, Codex, or Pi CLI installed</li>
              <li>&#8226; An AI provider account (Claude, OpenAI, etc.)</li>
              <li>&#8226; An iPhone/iPad (iOS 15+) or Android device (8.0+)</li>
              <li>&#8226; Same WiFi network, or a relay configured for remote access</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">How do I install the bridge?</h3>
            <p className="text-muted-foreground mb-3">
              Run these commands in your terminal:
            </p>
            <CodeBlock language="bash">{`broski install
broski-link pair`}</CodeBlock>
            <p className="text-muted-foreground text-sm mt-2">
              This starts Broski Link as a background service and shows a QR code to pair with your phone.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Can I use Broski on multiple computers?</h3>
            <p className="text-muted-foreground">
              Yes, but one bridge instance connects to one AI backend at a time. Install Broski Link on each computer,
              pair each one with its own QR code, and pick the computer you want to use in the app.
              Sessions are stored per-computer.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Why can&apos;t I scan the QR code?</h3>
            <ul className="text-muted-foreground space-y-2">
              <li>&#8226; A pairing QR expires after 10 minutes and works once &mdash; run <code className="px-1 py-0.5 bg-muted rounded text-sm">broski-link pair</code> for a new one</li>
              <li>&#8226; Check that <code className="px-1 py-0.5 bg-muted rounded text-sm">broski status</code> shows the service running</li>
              <li>&#8226; Try increasing terminal brightness</li>
              <li>&#8226; Move closer to the screen for better camera focus</li>
              <li>&#8226; Copy the <code className="px-1 py-0.5 bg-muted rounded text-sm">broski://pair</code> link and use the paste button on the scan screen</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">How do I update Broski?</h3>
            <p className="text-muted-foreground mb-2">
              <strong className="text-foreground">Bridge:</strong> Download and install the latest version for your platform.
            </p>
            <p className="text-muted-foreground">
              <strong className="text-foreground">App:</strong> Update from App Store (iOS) or Play Store (Android).
            </p>
          </div>
        </div>
      </section>

      {/* Connection */}
      <section className="mb-12">
        <h2 id="connection" className="text-2xl font-semibold mb-6">Connection</h2>
        
        <div className="space-y-6">
          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Do I need to be on the same WiFi?</h3>
            <p className="text-muted-foreground">
              For the direct route, yes. To use Broski from anywhere, configure a relay on your Mac (see Remote Access).
              No VPN and no extra app on your phone is needed.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Can multiple phones connect to the same bridge?</h3>
            <p className="text-muted-foreground">
              Yes! Multiple devices can connect simultaneously. Each phone registers with a unique ID, 
              and all phones see the same sessions and projects. Messages from any phone go to the same AI.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Can I use Broski over cellular data?</h3>
            <p className="text-muted-foreground">
              Yes, if your Mac has a relay configured. Local IPs (192.168.x.x) don&apos;t work on cellular, so the app
              uses the relay. Data usage is light (1-50 KB per message).
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Why does my connection keep dropping?</h3>
            <ul className="text-muted-foreground space-y-2">
              <li>&#8226; Check your WiFi signal strength</li>
              <li>&#8226; The bridge may have crashed - restart it</li>
              <li>&#8226; Keep the app in foreground (mobile OSes kill background apps)</li>
              <li>&#8226; Run <code className="px-1 py-0.5 bg-muted rounded text-sm">broski-link status</code> to check the relay and your phone&apos;s route</li>
              <li>&#8226; On Android, disable battery optimization for Broski</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Why does the connection drop when I leave my house?</h3>
            <p className="text-muted-foreground">
              The direct route only works on your home network. When you leave, the app switches to the relay if you
              configured one in <code className="px-1 py-0.5 bg-muted rounded text-sm">~/.broski/link/config.json</code>.
              Without a relay, your Mac is unreachable until you are back on its network.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">What do the connection bars mean?</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-muted-foreground mt-2">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-2 text-foreground">Bars</th>
                    <th className="text-left py-2 text-foreground">Quality</th>
                    <th className="text-left py-2 text-foreground">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/30">
                    <td className="py-2">4</td>
                    <td className="py-2">Excellent</td>
                    <td className="py-2">&lt; 30ms</td>
                  </tr>
                  <tr className="border-b border-border/30">
                    <td className="py-2">3</td>
                    <td className="py-2">Good</td>
                    <td className="py-2">30-100ms</td>
                  </tr>
                  <tr className="border-b border-border/30">
                    <td className="py-2">2</td>
                    <td className="py-2">Fair</td>
                    <td className="py-2">100-200ms</td>
                  </tr>
                  <tr>
                    <td className="py-2">1</td>
                    <td className="py-2">Poor</td>
                    <td className="py-2">&gt; 200ms</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* AI Backends */}
      <section className="mb-12">
        <h2 id="ai-backends" className="text-2xl font-semibold mb-6">AI Backends</h2>
        
        <div className="space-y-6">
          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">What&apos;s the difference between OpenCode and Claude Code?</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-muted-foreground mt-3">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-2 text-foreground">Aspect</th>
                    <th className="text-left py-2 text-foreground">OpenCode</th>
                    <th className="text-left py-2 text-foreground">Claude Code</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/30">
                    <td className="py-2">Creator</td>
                    <td className="py-2">Open source</td>
                    <td className="py-2">Anthropic (official)</td>
                  </tr>
                  <tr className="border-b border-border/30">
                    <td className="py-2">AI Providers</td>
                    <td className="py-2">75+ (Claude, GPT, Gemini, etc.)</td>
                    <td className="py-2">Claude only</td>
                  </tr>
                  <tr className="border-b border-border/30">
                    <td className="py-2">MCP Support</td>
                    <td className="py-2">Full</td>
                    <td className="py-2">Yes</td>
                  </tr>
                  <tr>
                    <td className="py-2">Best for</td>
                    <td className="py-2">Multi-provider flexibility</td>
                    <td className="py-2">Claude-only users</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Can I switch between backends?</h3>
            <p className="text-muted-foreground">
              Yes! Go to Settings &gt; AI Backend in the app to switch between Claude Code, 
              OpenCode, Codex, and Pi. The bridge will reconnect with the selected backend. 
              Note that sessions are per-backend - they don&apos;t transfer.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Are my sessions shared between backends?</h3>
            <p className="text-muted-foreground">
              No - each backend maintains separate session storage. OpenCode sessions are in 
              <code className="px-1 py-0.5 bg-muted rounded text-sm">~/.opencode/</code>, Claude Code sessions 
              are stored separately. Switching backends shows different sessions.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Can I use local/self-hosted models?</h3>
            <p className="text-muted-foreground">
              Yes, if you use OpenCode with Ollama or similar local inference. Install Ollama, 
              pull a model (<code className="px-1 py-0.5 bg-muted rounded text-sm">ollama pull llama3</code>), 
              configure OpenCode to use it, and Broski will work with the local model.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">How do I configure my API key?</h3>
            <p className="text-muted-foreground">
              API keys are configured in your chosen backend (OpenCode, Claude Code, Codex, or Pi), not in Broski. Set environment variables 
              like <code className="px-1 py-0.5 bg-muted rounded text-sm">ANTHROPIC_API_KEY</code> or use 
              <code className="px-1 py-0.5 bg-muted rounded text-sm">claude login</code> for Claude Code.
            </p>
          </div>
        </div>
      </section>

      {/* Usage */}
      <section className="mb-12">
        <h2 id="usage" className="text-2xl font-semibold mb-6">Using the App</h2>
        
        <div className="space-y-6">
          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">What can I do with Broski?</h3>
            <ul className="text-muted-foreground space-y-2">
              <li>&#8226; Chat with AI in real-time with streaming responses</li>
              <li>&#8226; Review code diffs before they&apos;re applied</li>
              <li>&#8226; Approve or reject file changes and commands</li>
              <li>&#8226; Switch between projects and sessions</li>
              <li>&#8226; Browse files and search your codebase</li>
              <li>&#8226; View AI thinking and tool execution</li>
              <li>&#8226; Attach images to your conversations</li>
              <li>&#8226; Fork, share, and manage sessions</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Can I use Broski offline?</h3>
            <p className="text-muted-foreground">
              Partially. You can view cached sessions and messages offline, but you need 
              an active connection to the bridge to send new messages or interact with AI.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">How do I attach images to messages?</h3>
            <p className="text-muted-foreground">
              Tap the attachment button in the chat input bar. You can take a photo 
              or select from your photo library. The AI can analyze images and use 
              them as context for your requests.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">What happens to my sessions when I disconnect?</h3>
            <p className="text-muted-foreground">
              Sessions persist on your computer - they&apos;re not stored on your phone. When you reconnect, 
              all sessions reload from your system. Any in-progress AI responses will have completed (or failed). 
              Recent messages are cached for offline viewing.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Why do I need to approve permissions?</h3>
            <p className="text-muted-foreground">
              Some AI actions are potentially dangerous (running commands, editing files, deleting things). 
              Broski requires your explicit approval for these actions. This is a safety feature - the AI 
              can&apos;t do anything destructive without your permission.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Can I always allow certain tools?</h3>
            <p className="text-muted-foreground">
              Yes! Go to Settings &gt; Tools and toggle &quot;Always Allow&quot; for specific tools. 
              Read is usually safe to always allow. Edit and Bash are better to approve each time.
            </p>
          </div>
        </div>
      </section>

      {/* Advanced */}
      <section className="mb-12">
        <h2 id="advanced" className="text-2xl font-semibold mb-6">Advanced</h2>
        
        <div className="space-y-6">
          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Can I run the bridge as a background service?</h3>
            <p className="text-muted-foreground mb-2">
              Yes! Use launchd (macOS), systemd (Linux), or Task Scheduler (Windows).
            </p>
            <p className="text-muted-foreground text-sm">
              See the <a href="/docs/bridge/background-service" className="text-primary hover:underline">Background Service Guide</a> for instructions.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">How do I use a custom port?</h3>
            <CodeBlock language="bash">{`# Use --port flag
broski --port 8080

# Or set environment variable
BROSKI_PORT=8080 broski`}</CodeBlock>
            <p className="text-muted-foreground text-sm mt-2">
              Note: this is the bridge&apos;s loopback port (used by agent hooks). Paired phones are not affected.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Can I configure the bridge with environment variables?</h3>
            <p className="text-muted-foreground mb-2">
              Yes! All CLI options have environment variable equivalents:
            </p>
            <ul className="text-muted-foreground text-sm space-y-1">
              <li>&#8226; <code className="px-1 py-0.5 bg-muted rounded">BROSKI_PORT</code> - Port number</li>
              <li>&#8226; <code className="px-1 py-0.5 bg-muted rounded">OPENCODE_BASE_URL</code> - OpenCode server URL</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">How do I reset everything and start fresh?</h3>
            <CodeBlock language="bash">{`# Clear bridge and link data (removes every pairing; pair again afterwards)
broski uninstall
rm -rf ~/.broski

# Clear OpenCode data (deletes all sessions!)
rm -rf ~/.opencode`}</CodeBlock>
            <p className="text-muted-foreground text-sm mt-2">
              On your phone: Settings &gt; Clear Cache, or uninstall and reinstall the app.
            </p>
          </div>
        </div>
      </section>

      {/* Privacy */}
      <section className="mb-12">
        <h2 id="privacy" className="text-2xl font-semibold mb-6">Privacy &amp; Security</h2>

        <div className="space-y-6">
          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Does Broski send my code to the cloud?</h3>
            <p className="text-muted-foreground">
              No. Your code stays on your system at all times. When you chat with AI, your prompts are sent to your
              configured AI provider (Anthropic, OpenAI, etc.) by the agent running on your system &mdash; exactly
              the same as if you used Claude Code or OpenCode directly in your terminal. Broski doesn&apos;t add,
              intercept, or route anything through our servers. We don&apos;t operate servers that touch your code.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Is my connection encrypted?</h3>
            <p className="text-muted-foreground mb-3">
              Yes, always, whichever route you use:
            </p>
            <ul className="text-muted-foreground space-y-2">
              <li>&#8226; <strong className="text-foreground">Local network:</strong> Noise end-to-end encryption (hybrid X25519 + ML-KEM-768). Your phone verifies your Mac&apos;s fingerprint from the QR code, so a man-in-the-middle attack is blocked even on untrusted WiFi.</li>
              <li>&#8226; <strong className="text-foreground">Relay:</strong> The same end-to-end session runs through the relay. The relay forwards ciphertext and cannot read it.</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Does Broski collect analytics or telemetry?</h3>
            <p className="text-muted-foreground">
              Zero. Not &ldquo;minimal&rdquo; or &ldquo;anonymous&rdquo; &mdash; zero. There is no Firebase, no Mixpanel,
              no Amplitude, no Sentry, no Crashlytics, no Segment in the app or bridge. We don&apos;t track screen views,
              tap events, session duration, or any behavioral data. If the app crashes, we don&apos;t know unless you email
              us. Our revenue comes from subscriptions, not data.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Where is my data stored?</h3>
            <ul className="text-muted-foreground space-y-2">
              <li>&#8226; <strong className="text-foreground">Pairing data:</strong> Encrypted in iOS Keychain (hardware-backed) / Android EncryptedSharedPreferences (AES-256)</li>
              <li>&#8226; <strong className="text-foreground">Cached sessions &amp; messages:</strong> On your phone only, in encrypted storage. For offline viewing.</li>
              <li>&#8226; <strong className="text-foreground">AI conversations &amp; session history:</strong> On your computer only, managed by the AI backend.</li>
              <li>&#8226; <strong className="text-foreground">API keys:</strong> On your system only, in the OS keychain (macOS Keychain / Windows Credential Manager / Linux keyring) or local config files. Never sent through Broski.</li>
              <li>&#8226; <strong className="text-foreground">Hook token, loopback TLS cert &amp; link identity key:</strong> In <code className="px-1 py-0.5 bg-muted rounded text-sm">~/.broski/</code> on your system with restricted file permissions.</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Can someone else access my bridge?</h3>
            <p className="text-muted-foreground">
              Not without being paired. The bridge is not on the network: it listens on a local socket and on loopback
              only. The only network-facing process is <code className="px-1 py-0.5 bg-muted rounded text-sm">broski-link</code>,
              which completes an encrypted handshake only with phones you paired using the one-time secret in the QR code.
              To remove a phone: <code className="px-1 py-0.5 bg-muted rounded text-sm">broski-link revoke</code>
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">What third-party services does Broski use?</h3>
            <p className="text-muted-foreground mb-3">
              None for accounts or billing. Broski is local-first and open source.
            </p>
            <ul className="text-muted-foreground space-y-2">
              <li>&#8226; Pairing uses the one-time secret in the QR code. There is no Google/Apple sign-in or RevenueCat subscription. If you use a relay, it only forwards end-to-end encrypted data.</li>
            </ul>
            <p className="text-muted-foreground mt-3 text-sm">
              If you enable voice input, audio goes to Groq or OpenAI using your own API key. This is opt-in and off by default.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Is there a Broski subscription?</h3>
            <p className="text-muted-foreground">
              No. Broski is free and open source. Your pairing data stays on your phone and machine.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">How do I delete all my data?</h3>
            <p className="text-muted-foreground mb-3">
              <strong className="text-foreground">Phone:</strong> Settings &gt; Clear Cache removes all cached data.
              Uninstalling the app removes everything from your device.
            </p>
            <p className="text-muted-foreground mb-3">
              <strong className="text-foreground">System:</strong> Delete <code className="px-1 py-0.5 bg-muted rounded text-sm">~/.broski</code> to
              remove all bridge data (hook token, certs, config, link state).
            </p>
            <p className="text-muted-foreground text-sm">
              That&apos;s it. There&apos;s nothing on our end to delete because we never had your data in the first place.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Can I verify all of this myself?</h3>
            <p className="text-muted-foreground">
              Yes. Run <code className="px-1 py-0.5 bg-muted rounded text-sm">broski doctor</code> to run 30+
              diagnostics on your setup (loopback TLS cert, hook token status, port bindings, daemon health), and{" "}
              <code className="px-1 py-0.5 bg-muted rounded text-sm">broski-link status</code> to see the link. Use Wireshark to
              inspect network traffic &mdash; you&apos;ll see only encrypted Broski Link frames between your phone and Mac
              (or your relay), and nothing going to any Broski endpoint. The bridge runs on your machine; you can inspect every line of traffic.
            </p>
            <p className="text-muted-foreground mt-2 text-sm">
              For the full deep-dive, see our <a href="/docs/security" className="text-primary hover:underline">Security &amp; Privacy</a> documentation.
            </p>
          </div>
        </div>
      </section>

      {/* Troubleshooting */}
      <section className="mb-12">
        <h2 id="troubleshooting" className="text-2xl font-semibold mb-6">Troubleshooting</h2>
        
        <div className="space-y-6">
          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">The bridge says &quot;Port already in use&quot;</h3>
            <CodeBlock language="bash">{`# Find what's using the port
lsof -nP -iTCP:18274 -sTCP:LISTEN

# Kill it
kill <PID>

# Or use a different port
broski --port 8080`}</CodeBlock>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">The app shows my Mac as &quot;Offline&quot; or &quot;Asleep&quot;</h3>
            <p className="text-muted-foreground">
              Check that <code className="px-1 py-0.5 bg-muted rounded text-sm">broski-link</code> is running with{" "}
              <code className="px-1 py-0.5 bg-muted rounded text-sm">broski status</code>, that the Mac is awake, and that
              the phone can reach it on the local network or through a relay. If the phone was removed with{" "}
              <code className="px-1 py-0.5 bg-muted rounded text-sm">broski-link revoke</code>, pair it again with{" "}
              <code className="px-1 py-0.5 bg-muted rounded text-sm">broski-link pair</code>.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">The chat is stuck on &quot;busy&quot;</h3>
            <p className="text-muted-foreground mb-2">
              The session is stuck. Try:
            </p>
            <ol className="text-muted-foreground space-y-1 list-decimal ml-4">
              <li>Tap the stop button in the chat</li>
              <li>Pull down to refresh the session list</li>
              <li>Restart the bridge (Ctrl+C, then <code className="px-1 py-0.5 bg-muted rounded text-sm">broski</code>)</li>
            </ol>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">OpenCode won&apos;t start</h3>
            <CodeBlock language="bash">{`# Check if installed
which opencode

# If not found, install it
curl -fsSL https://opencode.ai/install | bash
# or: bun add -g opencode-ai

# Try manual mode
opencode serve
# Then in another terminal:
broski --opencode-url http://localhost:4096`}</CodeBlock>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">How do I see debug logs?</h3>
            <CodeBlock language="bash">{`# Follow logs live
broski logs --follow

# Export diagnostics bundle
broski logs --export

# Run interactive troubleshooter
broski troubleshoot`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* Still have questions */}
      <section className="bg-card/50 border border-border/50 rounded-lg p-6">
        <h2 id="help" className="text-xl font-semibold mb-3">Still have questions?</h2>
        <p className="text-muted-foreground mb-4">
          We&apos;re here to help. Reach out through any of these channels:
        </p>
        <div className="flex flex-wrap gap-3">
          <a 
            href="mailto:broskiappp@gmail.com"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Email Support
          </a>
          <a 
            href="/docs/troubleshooting"
            className="inline-flex items-center gap-2 px-4 py-2 border border-border/50 rounded-lg hover:bg-muted/50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            Troubleshooting Guide
          </a>
        </div>
      </section>
    </article>
  );
}
