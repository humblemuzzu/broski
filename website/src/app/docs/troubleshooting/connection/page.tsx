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
          Run these commands on your Mac:
        </p>
        <CodeBlock language="bash">{`# Bridge, relay, local addresses and each phone's route
broski-link status

# Paired phones
broski-link devices

# Service, port and TLS checks
broski doctor --profile network

# Apply safe automatic fixes
broski doctor --fix

# Export diagnostics bundle
broski doctor --export`}</CodeBlock>
      </section>

      {/* Connection States */}
      <section className="mb-12">
        <h2 id="connection-states" className="text-2xl font-semibold mb-4">Connection States</h2>
        <p className="text-muted-foreground mb-4">
          The app shows the state of the link to each paired computer:
        </p>

        <SimpleTable
          headers={["State", "What It Means", "User Action"]}
          rows={[
            ["Connected", "Linked to your Mac, directly or through the relay", "None needed"],
            ["Connecting", "Establishing the encrypted link", "Wait a few seconds"],
            ["Asleep", "Your Mac went to sleep", "Wake it"],
            ["Offline", "Your Mac is not reachable by either route", "Check that the Mac is on and that broski-link is running"],
            ["Disconnected", "No active link", "Open the computer in the app to reconnect"],
          ]}
        />
      </section>

      {/* Cannot Connect */}
      <section className="mb-12">
        <h2 id="cannot-connect" className="text-2xl font-semibold mb-4">Cannot Connect to Your Mac</h2>

        <Callout type="warning" title="Symptom">
          The app shows &quot;Offline&quot; or &quot;Disconnected&quot;
        </Callout>

        <Steps
          steps={[
            {
              title: "Is the service running?",
              content: (
                <CodeBlock language="bash">{`broski status
broski-link status

# If the service is not installed
broski install`}</CodeBlock>
              ),
            },
            {
              title: "Is the bridge up?",
              description: "broski-link status shows the bridge as up, starting, crashed or down. If it crashed, the reason is shown and broski-link restarts it.",
              content: (
                <CodeBlock language="bash">{`broski restart
broski logs --follow`}</CodeBlock>
              ),
            },
            {
              title: "Are you on the same network?",
              description: "For the direct route, both devices must be on the same network. Otherwise the phone needs a relay (see Remote Access).",
            },
            {
              title: "Is the firewall blocking connections?",
              content: (
                <CodeBlock language="bash">{`# macOS: Check firewall status
/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate

# Linux (UFW): Check firewall status
sudo ufw status`}</CodeBlock>
              ),
            },
            {
              title: "Is the phone still paired?",
              description: "If the phone is not listed in broski-link devices, it was revoked or never finished pairing. Run broski-link pair and scan the new QR code.",
            },
          ]}
        />

        <h3 id="solutions-table" className="text-lg font-semibold mt-6 mb-3">Solutions by Cause</h3>
        <SimpleTable
          headers={["Cause", "Solution"]}
          rows={[
            ["Service not running", <code key="1">broski install</code>],
            ["Wrong network and no relay", "Join the same WiFi as the Mac, or configure a relay"],
            ["Firewall blocking", "Allow incoming connections for broski-link (default port 18275)"],
            ["Phone was revoked or unpaired", <code key="2">broski-link pair</code>],
            ["Stale connection", "Force quit the app and reopen it"],
          ]}
        />
      </section>

      {/* Port In Use */}
      <section className="mb-12">
        <h2 id="port-in-use" className="text-2xl font-semibold mb-4">Port Already in Use</h2>

        <Callout type="warning" title="Error Message">
          <code>Bridge port 18274 is already in use.</code>
        </Callout>

        <p className="text-muted-foreground mt-4 mb-4">
          Port 18274 is the bridge&apos;s loopback listener (used by agent hooks). Phones never
          connect to it, so changing it does not affect pairing.
        </p>

        <h3 id="diagnose-port" className="text-lg font-semibold mt-4 mb-3">Diagnosis</h3>
        <CodeBlock language="bash">{`# Find what's using the port
lsof -nP -iTCP:18274 -sTCP:LISTEN`}</CodeBlock>

        <h3 id="port-solutions" className="text-lg font-semibold mt-6 mb-3">Solutions</h3>
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Option 1: Kill the existing process</div>
            <CodeBlock language="bash">{`# Get the PID from lsof output, then:
kill <PID>`}</CodeBlock>
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
broski --port 0

# Specific port
broski --port 18276`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* Link keepalive */}
      <section className="mb-12">
        <h2 id="keepalive" className="text-2xl font-semibold mb-4">Link Keepalive</h2>
        <p className="text-muted-foreground mb-4">
          Broski Link detects dead connections itself:
        </p>

        <SimpleTable
          headers={["Timer", "Value", "Purpose"]}
          rows={[
            ["Ping", "15 seconds", "Keepalive in both directions"],
            ["Dead connection", "45 seconds", "No answer = the session detaches and the app reconnects"],
          ]}
        />

        <CodeBlock language="bash">{`# Follow logs for connectivity issues
broski logs --follow
tail -f ~/.broski/logs/link.log`}</CodeBlock>
      </section>

      {/* Connection Drops */}
      <section className="mb-12">
        <h2 id="connection-drops" className="text-2xl font-semibold mb-4">Connection Keeps Dropping</h2>

        <SimpleTable
          headers={["Cause", "Diagnosis", "Solution"]}
          rows={[
            ["Network instability", "Check WiFi signal strength", "Move closer to router or use wired"],
            ["WiFi switching", "Phone auto-switching networks", "Lock WiFi network in phone settings"],
            ["Background app killing", "iOS/Android battery saving", "Disable battery optimization for Broski"],
            ["Mac sleeping", "State shows Asleep", "Keep the Mac awake"],
          ]}
        />
      </section>

      {/* Firewall Configuration */}
      <section className="mb-12">
        <h2 id="firewall" className="text-2xl font-semibold mb-4">Firewall Configuration</h2>
        <p className="text-muted-foreground mb-4">
          Only the direct route needs an inbound rule: broski-link listens on port 18275 by default
          (change it with <code>lan_port</code> in <code>~/.broski/link/config.json</code>). The relay
          route needs outbound connections only.
        </p>

        <h3 id="macos-firewall" className="text-lg font-semibold mb-3">macOS</h3>
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">GUI Method</div>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>System Settings → Network → Firewall</li>
              <li>Click &quot;Options...&quot;</li>
              <li>Add the broski-link binary to allowed applications</li>
              <li>Or enable &quot;Automatically allow built-in software&quot;</li>
            </ol>
          </div>
        </div>

        <h3 id="linux-firewall" className="text-lg font-semibold mt-6 mb-3">Linux (UFW)</h3>
        <CodeBlock language="bash">{`# Allow the Broski Link port
sudo ufw allow 18275/tcp

# Check status
sudo ufw status`}</CodeBlock>

        <h3 id="linux-firewalld" className="text-lg font-semibold mt-6 mb-3">Linux (firewalld)</h3>
        <CodeBlock language="bash">{`# Allow the Broski Link port
sudo firewall-cmd --permanent --add-port=18275/tcp
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
            ["Expired QR error", "A pairing QR expires after 10 minutes. Run broski-link pair again"],
            ["Already used", "A pairing QR works once. Run broski-link pair again"],
            ["\"Old Broski QR\" message", "The code came from an older version. Update broski on your Mac and scan the new code"],
            ["Partial scan", "Hold phone steady for 2-3 seconds"],
          ]}
        />

        <h3 id="paste-link" className="text-lg font-semibold mt-6 mb-3">Paste the Link Instead</h3>
        <p className="text-muted-foreground mb-4">
          If scanning fails, copy the <code>broski://pair?...</code> link that <code>broski-link pair</code> prints
          and use the paste button on the scan screen.
        </p>
      </section>

      {/* Still Having Issues */}
      <section className="bg-card/50 border border-border/50 rounded-lg p-6">
        <h2 id="help" className="text-xl font-semibold mb-3">Still having issues?</h2>
        <p className="text-muted-foreground mb-4">
          Collect this debug info before contacting support:
        </p>
        <CodeBlock language="bash">{`broski --version
broski-link status --json
broski doctor --export`}</CodeBlock>
        <p className="text-muted-foreground mt-4">
          Email: <a href="mailto:broskiappp@gmail.com" className="text-primary hover:underline">broskiappp@gmail.com</a>
        </p>
      </section>
    </article>
  );
}
