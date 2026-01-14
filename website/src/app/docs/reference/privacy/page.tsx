import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy & Security - Broski",
  description: "How Broski protects your code and data",
};

export default function PrivacySecurityPage() {
  return (
    <article className="max-w-3xl">
      <h1 id="privacy-security" className="text-4xl font-bold mb-4">Privacy &amp; Security</h1>
      <p className="text-xl text-muted-foreground mb-8">
        How Broski protects your code and data.
      </p>

      {/* Overview */}
      <section className="mb-12">
        <h2 id="overview" className="text-2xl font-semibold mb-4">Overview</h2>
        <p className="text-muted-foreground mb-4">
          Broski is designed with privacy as a core principle. Your code stays on your machine - 
          Broski only facilitates the connection between your phone and your local AI agent.
        </p>
        
        <div className="bg-muted/30 border border-border rounded-lg p-4">
          <h3 className="font-medium mb-2">Key Privacy Features</h3>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>No cloud servers - direct device-to-device connection</li>
            <li>No analytics or telemetry collection</li>
            <li>Code never leaves your network (unless using AI APIs)</li>
            <li>Authentication tokens are cryptographically secure</li>
          </ul>
        </div>
      </section>

      {/* Data Flow */}
      <section className="mb-12">
        <h2 id="data-flow" className="text-2xl font-semibold mb-4">Data Flow</h2>
        
        <div className="border border-border/50 rounded-lg p-4 mb-4">
          <h3 className="font-medium mb-2">What stays local</h3>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Your source code files</li>
            <li>Session history and conversations</li>
            <li>Authentication tokens</li>
            <li>Configuration files</li>
          </ul>
        </div>

        <div className="border border-border/50 rounded-lg p-4 mb-4">
          <h3 className="font-medium mb-2">What goes to AI providers</h3>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Your prompts and questions</li>
            <li>Code snippets you ask about (only when you ask)</li>
            <li>File contents the AI needs to read (only when requested)</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-2">
            This is the same data that would be sent if you used the AI directly in your terminal.
          </p>
        </div>

        <div className="border border-border/50 rounded-lg p-4">
          <h3 className="font-medium mb-2">What Broski never sees</h3>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Your API keys (stored locally only)</li>
            <li>Your conversation content</li>
            <li>Your file system</li>
            <li>Your network traffic</li>
          </ul>
        </div>
      </section>

      {/* Authentication */}
      <section className="mb-12">
        <h2 id="authentication" className="text-2xl font-semibold mb-4">Authentication Security</h2>
        
        <div className="space-y-4">
          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-medium mb-2">Token Generation</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>Generated using <code className="bg-muted/50 px-1 rounded">crypto.randomBytes(24)</code></li>
              <li>24 bytes = 192 bits of entropy</li>
              <li>Encoded as base64url (URL-safe)</li>
              <li>Practically impossible to guess</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-medium mb-2">Token Storage</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>Stored at <code className="bg-muted/50 px-1 rounded">~/.broski/token</code></li>
              <li>File permissions: 0600 (owner read/write only)</li>
              <li>Never transmitted except in QR code</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Network Security */}
      <section className="mb-12">
        <h2 id="network" className="text-2xl font-semibold mb-4">Network Security</h2>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-border/50 rounded-lg">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left p-3 border-b border-border/50">Connection Type</th>
                <th className="text-left p-3 border-b border-border/50">Encryption</th>
                <th className="text-left p-3 border-b border-border/50">Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-3 border-b border-border/30">Local WiFi</td>
                <td className="p-3 border-b border-border/30">WPA2/WPA3 (network level)</td>
                <td className="p-3 border-b border-border/30">Secured by your WiFi</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/30">Tailscale VPN</td>
                <td className="p-3 border-b border-border/30">WireGuard (end-to-end)</td>
                <td className="p-3 border-b border-border/30">Military-grade encryption</td>
              </tr>
              <tr>
                <td className="p-3">Tailscale Funnel</td>
                <td className="p-3">HTTPS/TLS</td>
                <td className="p-3">Public HTTPS via Tailscale</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* What We Don't Collect */}
      <section className="mb-12">
        <h2 id="no-collection" className="text-2xl font-semibold mb-4">What We Don&apos;t Collect</h2>
        <p className="text-muted-foreground mb-4">
          Broski has no analytics, telemetry, or data collection:
        </p>
        <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
          <li>No usage tracking</li>
          <li>No error reporting (unless you contact support)</li>
          <li>No device fingerprinting</li>
          <li>No third-party analytics SDKs</li>
          <li>No advertising</li>
        </ul>
      </section>

      {/* Next Steps */}
      <section className="mt-12 pt-8 border-t border-border/50">
        <h2 id="next-steps" className="text-lg font-semibold mb-4">Related</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/legal/privacy" className="block p-4 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Privacy Policy</h3>
            <p className="text-sm text-muted-foreground">Full legal privacy policy</p>
          </a>
          <a href="/docs/bridge/remote-access" className="block p-4 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Remote Access</h3>
            <p className="text-sm text-muted-foreground">Secure Tailscale setup</p>
          </a>
        </div>
      </section>
    </article>
  );
}
