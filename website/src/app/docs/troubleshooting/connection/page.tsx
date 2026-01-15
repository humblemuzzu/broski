import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";
import { SimpleTable } from "@/components/docs/docs-table";
import { Callout } from "@/components/docs/callout";
import { Steps } from "@/components/docs/steps";

export const metadata: Metadata = {
  title: "Connection Issues - Broski",
  description: "Troubleshoot connection problems with Broski",
};

export default function ConnectionTroubleshootingPage() {
  return (
    <article className="max-w-3xl">
      <h1 id="connection-issues" className="text-4xl font-bold mb-4">Connection Issues</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Can&apos;t connect? Here&apos;s how to diagnose and fix connection problems.
      </p>

      {/* Quick Diagnostics */}
      <section className="mb-12">
        <h2 id="diagnostics" className="text-2xl font-semibold mb-4">Quick Diagnostics</h2>
        <p className="text-muted-foreground mb-4">
          Run these commands to check your setup:
        </p>
        <CodeBlock language="bash">{`# Check if bridge is running
curl http://localhost:18274/
# Expected: {"status":"ok"}

# Check what's using the port
lsof -nP -iTCP:18274 -sTCP:LISTEN

# Check Tailscale status (if using)
tailscale status

# Run full diagnostics
bunx broski doctor`}</CodeBlock>
      </section>

      {/* Connection State Machine */}
      <section className="mb-12">
        <h2 id="connection-states" className="text-2xl font-semibold mb-4">Connection States</h2>
        <p className="text-muted-foreground mb-4">
          Understanding how the connection state machine works:
        </p>
        
        <div className="bg-muted/30 rounded-lg border border-border p-6 mb-4">
          <div className="flex flex-col items-center gap-2">
            <div className="px-4 py-2 bg-red-500/20 border border-red-500/40 rounded-lg text-center">
              <span className="font-mono font-semibold">DISCONNECTED</span>
            </div>
            <div className="text-muted-foreground text-sm">↓ connect()</div>
            <div className="px-4 py-2 bg-yellow-500/20 border border-yellow-500/40 rounded-lg text-center">
              <span className="font-mono font-semibold">CONNECTING</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-muted-foreground text-sm">↓ success</div>
              <div className="text-muted-foreground text-sm opacity-50">timeout/error ↗</div>
            </div>
            <div className="px-4 py-2 bg-green-500/20 border border-green-500/40 rounded-lg text-center">
              <span className="font-mono font-semibold">CONNECTED</span>
            </div>
            <div className="text-muted-foreground text-sm">↓ disconnect() or network change</div>
            <div className="px-4 py-2 bg-orange-500/20 border border-orange-500/40 rounded-lg text-center">
              <span className="font-mono font-semibold">RECONNECTING</span>
              <span className="text-xs text-muted-foreground ml-2">→ retry → CONNECTING</span>
            </div>
          </div>
        </div>
        
        <SimpleTable
          headers={["State", "What It Means", "User Action"]}
          rows={[
            ["Disconnected", "No active connection", "Tap to connect or scan QR code"],
            ["Connecting", "Establishing WebSocket connection", "Wait a few seconds"],
            ["Connected", "Active connection, ready to use", "None needed"],
            ["Reconnecting", "Connection lost, auto-retry in progress", "Wait for auto-reconnect"],
          ]}
        />
      </section>

      {/* Cannot Connect */}
      <section className="mb-12">
        <h2 id="cannot-connect" className="text-2xl font-semibold mb-4">Cannot Connect to Bridge</h2>
        
        <Callout type="warning" title="Symptom">
          App shows &quot;Disconnected&quot; or &quot;Connection failed&quot;
        </Callout>

        <Steps
          steps={[
            {
              title: "Is the bridge running?",
              content: (
                <>
                  <CodeBlock language="bash">{`ps aux | grep broski`}</CodeBlock>
                  <p className="text-sm text-muted-foreground mt-2">
                    If nothing shows up, start the bridge:
                  </p>
                  <CodeBlock language="bash">{`bunx broski`}</CodeBlock>
                </>
              ),
            },
            {
              title: "Is the bridge healthy?",
              content: (
                <>
                  <CodeBlock language="bash">{`curl http://localhost:18274/
# Expected: {"status":"ok","version":"..."}`}</CodeBlock>
                </>
              ),
            },
            {
              title: "Are you on the same network?",
              description: "For local connections, both devices must be on the same WiFi. Check your phone's WiFi settings.",
            },
            {
              title: "Is the firewall blocking connections?",
              content: (
                <CodeBlock language="bash">{`# macOS: Check firewall status
/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate`}</CodeBlock>
              ),
            },
            {
              title: "Is the auth token correct?",
              description: "Re-scan the QR code to get a fresh token, or run bunx broski --new-token",
            },
          ]}
        />

        <h3 id="solutions-table" className="text-lg font-semibold mt-6 mb-3">Solutions by Cause</h3>
        <SimpleTable
          headers={["Cause", "Solution"]}
          rows={[
            ["Bridge not running", <code key="1">bunx broski</code>],
            ["Wrong network", "Connect phone to same WiFi as computer"],
            ["Firewall blocking", "Add exception for port 18274"],
            ["Token mismatch", "Re-scan QR code or run --new-token"],
            ["Stale connection", "Force quit app and reconnect"],
          ]}
        />
      </section>

      {/* Port In Use */}
      <section className="mb-12">
        <h2 id="port-in-use" className="text-2xl font-semibold mb-4">Port Already in Use</h2>
        
        <Callout type="warning" title="Error Message">
          <code>Bridge port 18274 is already in use.</code>
        </Callout>

        <h3 id="diagnose-port" className="text-lg font-semibold mt-4 mb-3">Diagnosis</h3>
        <CodeBlock language="bash">{`# Find what's using the port
lsof -nP -iTCP:18274 -sTCP:LISTEN

# Example output:
# COMMAND   PID   USER   FD   TYPE   DEVICE
# broski-b  1234  user   12u  IPv4   0x1234`}</CodeBlock>

        <h3 id="port-solutions" className="text-lg font-semibold mt-6 mb-3">Solutions</h3>
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Option 1: Kill the existing process</div>
            <CodeBlock language="bash">{`# Get the PID from lsof output, then:
kill <PID>

# Or kill all processes on the port:
lsof -nP -iTCP:18274 -sTCP:LISTEN | awk 'NR>1 {print $2}' | xargs kill`}</CodeBlock>
          </div>
          
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Option 2: Suspended process (Ctrl+Z issue)</div>
            <p className="text-sm text-muted-foreground mb-2">
              If you accidentally pressed Ctrl+Z instead of Ctrl+C:
            </p>
            <CodeBlock language="bash">{`# List suspended jobs
jobs

# Bring to foreground and stop properly
fg
# Then press Ctrl+C`}</CodeBlock>
          </div>
          
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Option 3: Use a different port</div>
            <CodeBlock language="bash">{`# Random free port
bunx broski --port 0

# Specific port
bunx broski --port 18275`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* Heartbeat & Ping-Pong */}
      <section className="mb-12">
        <h2 id="heartbeat" className="text-2xl font-semibold mb-4">Heartbeat / Ping-Pong</h2>
        <p className="text-muted-foreground mb-4">
          The bridge uses a heartbeat mechanism to detect dead connections:
        </p>

        <SimpleTable
          headers={["Parameter", "Value", "Purpose"]}
          rows={[
            ["Bridge ping interval", "20 seconds", "Server-initiated keepalive"],
            ["App ping interval", "15 seconds", "Client-initiated keepalive"],
            ["Pong timeout", "10 seconds", "Max wait for response"],
            ["Dead connection", "90 seconds", "No response = disconnect"],
          ]}
        />

        <Callout type="info" title="How it works">
          The bridge sends a ping every 20 seconds. If no pong response is received within 90 seconds, 
          the connection is considered dead and closed. The app will then attempt to reconnect automatically.
        </Callout>

        <CodeBlock language="bash">{`# Check bridge logs for heartbeat issues
bunx broski --verbose 2>&1 | grep -i heartbeat`}</CodeBlock>
      </section>

      {/* Connection Drops */}
      <section className="mb-12">
        <h2 id="connection-drops" className="text-2xl font-semibold mb-4">Connection Keeps Dropping</h2>
        
        <Callout type="note" title="Symptoms">
          Disconnects every few minutes, &quot;Heartbeat timeout&quot; in logs, constant reconnecting indicator
        </Callout>

        <SimpleTable
          headers={["Cause", "Diagnosis", "Solution"]}
          rows={[
            ["Network instability", "Check WiFi signal strength", "Move closer to router or use wired"],
            ["High latency", "RTT > 200ms in app", "Switch to local connection"],
            ["WiFi switching", "Phone auto-switching networks", "Lock WiFi network in phone settings"],
            ["Background app killing", "iOS/Android battery saving", "Disable battery optimization for Broski"],
            ["Server heartbeat timeout", "Bridge logs show timeout", "Restart bridge"],
          ]}
        />
      </section>

      {/* Firewall Configuration */}
      <section className="mb-12">
        <h2 id="firewall" className="text-2xl font-semibold mb-4">Firewall Configuration</h2>
        
        <h3 id="macos-firewall" className="text-lg font-semibold mb-3">macOS</h3>
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">GUI Method</div>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>System Settings → Network → Firewall</li>
              <li>Click &quot;Options...&quot;</li>
              <li>Add Bun or Node.js to allowed applications</li>
              <li>Or enable &quot;Automatically allow built-in software&quot;</li>
            </ol>
          </div>
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Terminal Method</div>
            <CodeBlock language="bash">{`# Check firewall status
/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate

# Add exception for Bun
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add $(which bun)

# Or disable firewall temporarily (not recommended for production)
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate off`}</CodeBlock>
          </div>
        </div>

        <h3 id="windows-firewall" className="text-lg font-semibold mt-6 mb-3">Windows</h3>
        <div className="border border-border rounded-lg p-4">
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Open Windows Security → Firewall &amp; network protection</li>
            <li>Click &quot;Allow an app through firewall&quot;</li>
            <li>Add <code className="bg-muted/50 px-1 rounded">bun.exe</code> or allow port 18274</li>
            <li>Ensure both Private and Public are checked</li>
          </ol>
        </div>

        <h3 id="linux-firewall" className="text-lg font-semibold mt-6 mb-3">Linux (UFW)</h3>
        <CodeBlock language="bash">{`# Allow bridge port
sudo ufw allow 18274/tcp

# Check status
sudo ufw status`}</CodeBlock>

        <h3 id="linux-firewalld" className="text-lg font-semibold mt-6 mb-3">Linux (firewalld)</h3>
        <CodeBlock language="bash">{`# Allow bridge port
sudo firewall-cmd --permanent --add-port=18274/tcp
sudo firewall-cmd --reload

# Check status
sudo firewall-cmd --list-ports`}</CodeBlock>
      </section>

      {/* QR Code Issues */}
      <section className="mb-12">
        <h2 id="qr-code" className="text-2xl font-semibold mb-4">QR Code Scanning Issues</h2>
        
        <SimpleTable
          headers={["Issue", "Solution"]}
          rows={[
            ["Camera won't focus", "Ensure adequate lighting, clean camera lens"],
            ["Code too small", "Move closer or increase terminal font size"],
            ["Invalid QR error", "Regenerate with bunx broski --new-token"],
            ["Partial scan", "Hold phone steady for 2-3 seconds"],
            ["Old QR code", "Token may have changed, regenerate"],
          ]}
        />

        <h3 id="manual-connection" className="text-lg font-semibold mt-6 mb-3">Manual Connection Alternative</h3>
        <p className="text-muted-foreground mb-4">
          If QR scanning fails, connect manually:
        </p>
        <ol className="text-muted-foreground space-y-2 list-decimal list-inside mb-4">
          <li>In the app, go to Settings → Connection → Manual Connect</li>
          <li>Enter the bridge URL shown in terminal</li>
        </ol>
        <CodeBlock language="text">{`ws://192.168.1.x:18274?token=YOUR_TOKEN`}</CodeBlock>
      </section>

      {/* Still Having Issues */}
      <section className="bg-card/50 border border-border/50 rounded-lg p-6">
        <h2 id="help" className="text-xl font-semibold mb-3">Still having issues?</h2>
        <p className="text-muted-foreground mb-4">
          Collect this debug info before contacting support:
        </p>
        <CodeBlock language="bash">{`bunx broski --version
bunx broski doctor
bun --version && node --version
sw_vers # macOS only`}</CodeBlock>
        <p className="text-muted-foreground mt-4">
          Email: <a href="mailto:broskiappp@gmail.com" className="text-primary hover:underline">broskiappp@gmail.com</a>
        </p>
      </section>
    </article>
  );
}
