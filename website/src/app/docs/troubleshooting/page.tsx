import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";

export const metadata: Metadata = {
  title: "Troubleshooting - Broski",
  description: "Common issues and solutions for Broski",
};

export default function TroubleshootingPage() {
  return (
    <article className="max-w-3xl">
      <h1 className="text-4xl font-bold mb-4">Troubleshooting</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Solutions to common issues and how to get help.
      </p>

      {/* Connection Issues */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">Connection Issues</h2>
        
        <div className="space-y-4">
          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2 text-destructive">Can&apos;t scan QR code</h3>
            <ul className="text-muted-foreground text-sm space-y-2">
              <li>&#8226; Make sure your phone and Mac are on the <strong className="text-foreground">same WiFi network</strong></li>
              <li>&#8226; Check that the bridge is still running in your terminal</li>
              <li>&#8226; Try moving closer to your screen for better camera focus</li>
              <li>&#8226; Increase terminal brightness or use a lighter terminal theme</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2 text-destructive">Connection keeps dropping</h3>
            <ul className="text-muted-foreground text-sm space-y-2">
              <li>&#8226; Check your WiFi signal strength</li>
              <li>&#8226; The bridge may have crashed - restart it</li>
              <li>&#8226; iOS may be killing the app in background - keep it in foreground</li>
              <li>&#8226; If using Tailscale, check both devices are connected</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2 text-destructive">&quot;Connection refused&quot; error</h3>
            <p className="text-muted-foreground text-sm mb-3">
              Your Mac&apos;s firewall might be blocking the connection:
            </p>
            <ol className="text-muted-foreground text-sm space-y-2">
              <li>1. Open System Settings &gt; Network &gt; Firewall</li>
              <li>2. Click &quot;Options&quot;</li>
              <li>3. Add Node.js or Bun to the allowed applications</li>
            </ol>
            <p className="text-muted-foreground text-sm mt-3">
              Or via terminal:
            </p>
            <CodeBlock language="bash">{`sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add $(which node)`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* AI Agent Issues */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">AI Agent Issues</h2>
        
        <div className="space-y-4">
          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2 text-destructive">No AI agents detected</h3>
            <p className="text-muted-foreground text-sm mb-3">
              The bridge automatically detects installed AI agents. Make sure you have at least one:
            </p>
            <ul className="text-muted-foreground text-sm space-y-2">
              <li>&#8226; <strong className="text-foreground">Claude Code:</strong> <code>npm install -g @anthropic-ai/claude-code</code></li>
              <li>&#8226; <strong className="text-foreground">OpenCode:</strong> <code>npm install -g opencode-ai</code></li>
              <li>&#8226; <strong className="text-foreground">Codex:</strong> <code>npm install -g @openai/codex</code></li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2 text-destructive">AI not responding</h3>
            <ul className="text-muted-foreground text-sm space-y-2">
              <li>&#8226; Check your API key is set correctly in the agent&apos;s config</li>
              <li>&#8226; Verify your API subscription is active</li>
              <li>&#8226; Check the bridge terminal for error messages</li>
              <li>&#8226; Try restarting the bridge</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2 text-destructive">Wrong AI backend connected</h3>
            <p className="text-muted-foreground text-sm">
              Use the Settings &gt; AI Backend screen in Broski to switch between Claude Code, 
              OpenCode, and Codex. The bridge will restart the connection with the selected agent.
            </p>
          </div>
        </div>
      </section>

      {/* App Issues */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">App Issues</h2>
        
        <div className="space-y-4">
          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2 text-destructive">App crashes on launch</h3>
            <ul className="text-muted-foreground text-sm space-y-2">
              <li>&#8226; Make sure you&apos;re running iOS 15 or later</li>
              <li>&#8226; Try deleting and reinstalling the app</li>
              <li>&#8226; Restart your iPhone</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2 text-destructive">Messages not syncing</h3>
            <ul className="text-muted-foreground text-sm space-y-2">
              <li>&#8226; Pull down to refresh the chat screen</li>
              <li>&#8226; Check connection status in the app header</li>
              <li>&#8226; Try disconnecting and reconnecting</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2 text-destructive">Can&apos;t see code diffs</h3>
            <p className="text-muted-foreground text-sm">
              Some AI agents don&apos;t support diff streaming. If you&apos;re seeing raw output instead 
              of formatted diffs, the agent may not be compatible with that feature.
            </p>
          </div>
        </div>
      </section>

      {/* Bridge Issues */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">Bridge Issues</h2>
        
        <div className="space-y-4">
          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2 text-destructive">Bridge won&apos;t start</h3>
            <ul className="text-muted-foreground text-sm space-y-2">
              <li>&#8226; Make sure Node.js 18+ or Bun is installed</li>
              <li>&#8226; Check if port 18274 is already in use: <code className="text-foreground">lsof -i :18274</code></li>
              <li>&#8226; Try a different port: <code className="text-foreground">broski --port 9000</code></li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2 text-destructive">QR code not displaying correctly</h3>
            <ul className="text-muted-foreground text-sm space-y-2">
              <li>&#8226; Make your terminal window wider</li>
              <li>&#8226; Use a smaller font size</li>
              <li>&#8226; Try a different terminal emulator</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2 text-destructive">High CPU usage</h3>
            <p className="text-muted-foreground text-sm">
              If the bridge is using too much CPU, try restarting it. Persistent high CPU 
              usually indicates an AI agent is stuck in a loop.
            </p>
          </div>
        </div>
      </section>

      {/* Getting Help */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">Still Need Help?</h2>
        
        <div className="bg-card/50 border border-border/50 rounded-lg p-6">
          <p className="text-muted-foreground mb-4">
            If you couldn&apos;t find a solution above, we&apos;re here to help:
          </p>
          <ul className="space-y-3">
            <li>
              <a 
                href="mailto:broskiappp@gmail.com" 
                className="text-primary hover:underline font-medium"
              >
                Email Support: broskiappp@gmail.com
              </a>
              <p className="text-muted-foreground text-sm mt-1">
                We typically respond within 24 hours
              </p>
            </li>
          </ul>
        </div>
      </section>

      {/* Debug Info */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Collecting Debug Info</h2>
        
        <p className="text-muted-foreground mb-4">
          When reporting issues, please include:
        </p>
        
        <CodeBlock language="bash">{`# Bridge version
broski --version

# Node/Bun version
node --version && bun --version

# macOS version
sw_vers`}</CodeBlock>
        
        <p className="text-muted-foreground text-sm mt-4">
          Also include your iOS version (Settings &gt; General &gt; About) and the Broski app version 
          (Settings screen in the app).
        </p>
      </section>
    </article>
  );
}
