import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";
import { SimpleTable } from "@/components/docs/docs-table";
import { Callout } from "@/components/docs/callout";
import { Steps } from "@/components/docs/steps";

export const metadata: Metadata = {
  title: "Troubleshooting - Broski",
  description: "Common issues and solutions for Broski",
};

export default function TroubleshootingPage() {
  return (
    <article className="max-w-3xl">
      <h1 id="troubleshooting" className="text-4xl font-bold mb-4">Troubleshooting</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Solutions to common issues and how to get help.
      </p>

      {/* Quick Diagnostics */}
      <section className="mb-12">
        <h2 id="quick-diagnostics" className="text-2xl font-semibold mb-4">Quick Diagnostics</h2>
        <p className="text-muted-foreground mb-4">
          Start with the <code className="bg-muted/50 px-1.5 py-0.5 rounded text-sm">broski doctor</code> command 
          to check your system for common issues:
        </p>
        <CodeBlock language="bash">{`bunx broski doctor`}</CodeBlock>

        <h3 id="what-doctor-checks" className="text-lg font-semibold mt-6 mb-3">What Doctor Checks</h3>
        <SimpleTable
          headers={["Check", "What It Means", "If It Fails"]}
          rows={[
            ["Bun", "Runtime for the bridge server", "Install Bun: curl -fsSL https://bun.sh/install | bash"],
            ["OpenCode", "AI coding assistant backend", "Install: bun install -g opencode"],
            ["Local IP", "Network connectivity for local connections", "Check WiFi, network interfaces"],
            ["Port 18274", "Default bridge port availability", "Kill existing process or use --port 0"],
            ["Tailscale", "Remote access VPN (optional)", "Install from tailscale.com"],
          ]}
        />

        <h3 id="reading-output" className="text-lg font-semibold mt-6 mb-3">Reading the Output</h3>
        <SimpleTable
          headers={["Symbol", "Status", "Meaning"]}
          rows={[
            [<code key="ok" className="text-[#7fd88f]">[OK]</code>, "Passed", "Check passed, no action needed"],
            [<code key="warn" className="text-amber-500">[!]</code>, "Warning", "Works but may have issues"],
            [<code key="err" className="text-red-500">[X]</code>, "Error", "Must be fixed before using Broski"],
          ]}
        />

        <h3 id="example-output" className="text-lg font-semibold mt-6 mb-3">Example Output</h3>
        <CodeBlock language="text">{`DEPENDENCIES
--------------------------------------------------
  [OK] Bun v1.1.0
  [OK] OpenCode v0.2.0

NETWORK
--------------------------------------------------
  [OK] Local IP: 192.168.1.100
  [OK] Port 18274 available
  [OK] Tailscale installed
  [OK] Tailscale running
  [OK] Tailscale IP: 100.100.100.1`}</CodeBlock>
      </section>

      {/* Quick Health Check Commands */}
      <section className="mb-12">
        <h2 id="health-check-commands" className="text-2xl font-semibold mb-4">Health Check Commands</h2>
        <p className="text-muted-foreground mb-4">
          Run these commands manually to diagnose specific issues:
        </p>
        <CodeBlock language="bash">{`# Check if bridge is running
curl http://localhost:18274/

# Check OpenCode directly
curl http://localhost:4096/path

# Check Tailscale status
tailscale status

# Check what's using the bridge port
lsof -nP -iTCP:18274 -sTCP:LISTEN`}</CodeBlock>
      </section>

      {/* Common Issues Quick Links */}
      <section className="mb-12">
        <h2 id="common-issues" className="text-2xl font-semibold mb-4">Common Issues</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/troubleshooting/connection" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Connection Issues</h3>
            <p className="text-sm text-muted-foreground">Can&apos;t connect, port in use, drops</p>
          </a>
          <a href="/docs/troubleshooting/network" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Network Issues</h3>
            <p className="text-sm text-muted-foreground">WiFi, firewall, Tailscale, VPN</p>
          </a>
          <a href="/docs/troubleshooting/ai-backends" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">AI Backend Issues</h3>
            <p className="text-sm text-muted-foreground">OpenCode, Claude Code, Codex</p>
          </a>
          <a href="/docs/troubleshooting/errors" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Error Reference</h3>
            <p className="text-sm text-muted-foreground">Complete error message lookup</p>
          </a>
        </div>
      </section>

      {/* Emergency Quick Fixes */}
      <section className="mb-12">
        <h2 id="emergency-fixes" className="text-2xl font-semibold mb-4">Emergency Quick Fixes</h2>
        <SimpleTable
          headers={["Problem", "Quick Fix"]}
          rows={[
            ["Can't connect", "Restart bridge, re-scan QR"],
            ["Port in use", <><code className="text-xs">lsof -nP -iTCP:18274</code> then <code className="text-xs">kill &lt;PID&gt;</code></>],
            ["Auth failed", <code key="auth" className="text-xs">bunx broski --new-token</code>],
            ["OpenCode missing", <code key="oc" className="text-xs">bun install -g opencode</code>],
            ["Everything broken", <><code className="text-xs">rm -rf ~/.broski/</code> and restart</>],
          ]}
        />
      </section>

      {/* Nuclear Options */}
      <section className="mb-12">
        <h2 id="nuclear-options" className="text-2xl font-semibold mb-4">Nuclear Options</h2>
        <p className="text-muted-foreground mb-4">
          When nothing else works, try these complete reset procedures:
        </p>

        <Callout type="warning" title="Warning">
          These steps delete data and require reconfiguration. Use as a last resort.
        </Callout>

        <h3 id="reset-mobile-app" className="text-lg font-semibold mt-6 mb-3">Reset Mobile App</h3>
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">iOS</div>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Delete the Broski app</li>
              <li>Restart your device</li>
              <li>Reinstall from App Store</li>
              <li>Re-scan QR code to connect</li>
            </ol>
          </div>
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Android</div>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Settings → Apps → Broski → Clear Data (not just cache)</li>
              <li>Force Stop</li>
              <li>Uninstall</li>
              <li>Reinstall from Play Store</li>
              <li>Re-scan QR code to connect</li>
            </ol>
          </div>
        </div>

        <h3 id="reset-bridge" className="text-lg font-semibold mt-6 mb-3">Reset Bridge</h3>
        <CodeBlock language="bash">{`# Stop the bridge (Ctrl+C in the terminal running it)

# Remove all Broski data
rm -rf ~/.broski/

# Reinstall bridge
bun install -g @broski/bridge

# Start fresh (generates new token)
bunx broski`}</CodeBlock>

        <h3 id="complete-reinstall" className="text-lg font-semibold mt-6 mb-3">Complete Reinstall</h3>
        <Steps
          steps={[
            {
              title: "Remove bridge",
              content: (
                <CodeBlock language="bash">{`rm -rf ~/.broski/
bun remove -g @broski/bridge`}</CodeBlock>
              ),
            },
            {
              title: "Reinstall bridge",
              content: <CodeBlock language="bash">{`bun install -g @broski/bridge`}</CodeBlock>,
            },
            {
              title: "Remove and reinstall mobile app",
              description: "Delete and reinstall from your app store",
            },
            {
              title: "Restart your computer and phone",
            },
            {
              title: "Start fresh",
              content: (
                <CodeBlock language="bash">{`bunx broski doctor  # Verify setup
bunx broski         # Start bridge`}</CodeBlock>
              ),
            },
            {
              title: "Scan new QR code",
              description: "Open the app and scan the QR code displayed in your terminal",
            },
          ]}
        />
      </section>

      {/* Getting Help */}
      <section className="mb-12">
        <h2 id="getting-help" className="text-2xl font-semibold mb-4">Getting Help</h2>
        
        <h3 id="collecting-debug-info" className="text-lg font-semibold mb-3">Collecting Debug Information</h3>
        <p className="text-muted-foreground mb-4">
          Before reporting an issue, collect this information:
        </p>
        <CodeBlock language="bash">{`# Bridge version
bunx broski --version

# Doctor output
bunx broski doctor

# Verbose logs (reproduce the issue while this runs)
bunx broski --verbose 2>&1 | tee broski-debug.log

# System info
sw_vers  # macOS
uname -a # Linux`}</CodeBlock>

        <h3 id="log-locations" className="text-lg font-semibold mt-6 mb-3">Log Locations</h3>
        <SimpleTable
          headers={["Component", "Location"]}
          rows={[
            ["Bridge logs", "Terminal output (use --verbose)"],
            ["Auth token", "~/.broski/token"],
            ["OpenCode logs", "Terminal output"],
            ["Claude Code sessions", "~/.claude/projects/"],
            ["iOS app logs", "Xcode Console or Analytics Data"],
            ["Android app logs", "adb logcat"],
          ]}
        />

        <h3 id="contact-support" className="text-lg font-semibold mt-6 mb-3">Contact Support</h3>
        <div className="bg-card/50 border border-border/50 rounded-lg p-6">
          <p className="text-muted-foreground mb-4">
            If you couldn&apos;t find a solution, we&apos;re here to help:
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
          <p className="text-muted-foreground text-sm mt-4">
            Include: App version (Settings → About), iOS/Android version, bridge version, 
            and the debug info collected above.
          </p>
        </div>
      </section>

      {/* Status Indicators */}
      <section className="mb-12">
        <h2 id="status-indicators" className="text-2xl font-semibold mb-4">Status Indicators</h2>
        <p className="text-muted-foreground mb-4">
          Understanding connection status in the app:
        </p>
        <SimpleTable
          headers={["Indicator", "Meaning"]}
          rows={[
            ["Green dot", "Connected and healthy"],
            ["Yellow dot", "Connected with issues (high latency)"],
            ["Red dot", "Disconnected"],
            ["Spinner", "Reconnecting"],
            ["\"Busy\" badge", "AI is processing"],
          ]}
        />
      </section>

      {/* Related Pages */}
      <section className="mt-12 pt-8 border-t border-border">
        <h2 id="related" className="text-lg font-semibold mb-4">Related</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/bridge/configuration" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Configuration</h3>
            <p className="text-sm text-muted-foreground">All CLI and config options</p>
          </a>
          <a href="/docs/reference/cli" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">CLI Reference</h3>
            <p className="text-sm text-muted-foreground">Complete command reference</p>
          </a>
        </div>
      </section>
    </article>
  );
}
