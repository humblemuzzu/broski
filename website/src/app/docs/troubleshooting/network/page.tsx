import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";
import { SimpleTable } from "@/components/docs/docs-table";
import { Callout } from "@/components/docs/callout";

export const metadata: Metadata = {
  title: "Network Issues - Broski",
  description: "Diagnose and fix network connectivity problems between your phone and your system",
};

export default function NetworkTroubleshootingPage() {
  return (
    <article className="max-w-3xl">
      <h1 id="network-issues" className="text-4xl font-bold mb-4">Network Issues</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Diagnose and fix network connectivity problems between your phone and your system.
      </p>

      {/* Diagnostics First */}
      <section className="mb-12">
        <h2 id="diagnostics" className="text-2xl font-semibold mb-4">Run Diagnostics First</h2>
        <p className="text-muted-foreground mb-4">
          Start with the link status and the focused doctor profiles:
        </p>
        <CodeBlock language="bash">{`broski-link status
broski doctor --profile network
broski doctor --fix`}</CodeBlock>
        <p className="text-sm text-muted-foreground mt-3">
          <code>broski-link status</code> shows whether the bridge is up, whether the relay is
          connected, the local addresses phones can use, and the route of each paired phone. The
          doctor checks port conflicts, the background service, and the local hook listener.
        </p>
      </section>

      {/* Local Connection Issues */}
      <section className="mb-12">
        <h2 id="local-issues" className="text-2xl font-semibold mb-4">Local Connection (Same Network)</h2>
        <p className="text-muted-foreground mb-4">
          The phone first tries the local addresses stored when you paired. Check these in order:
        </p>
        <SimpleTable
          headers={["Symptom", "Cause", "Fix"]}
          rows={[
            ["Link shows the relay, not the local network", "Phone and Mac are on different networks or subnets", "Join the same WiFi as your Mac"],
            ["Never connects locally", "Firewall blocks the Broski Link port (default 18275)", "Allow incoming connections for broski-link"],
            ["Stopped working after a router change", "Your Mac got a new address", "Run broski-link pair again to store the new addresses"],
            ["Guest or isolated WiFi", "Client isolation blocks device-to-device traffic", "Use a normal network, or set up a relay"],
          ]}
        />
        <Callout type="tip" title="No relay needed at home">
          A relay is only used when the phone cannot reach your Mac directly. On one network,
          Broski connects directly.
        </Callout>
      </section>

      {/* Corporate */}
      <section className="mb-12">
        <h2 id="corporate-network" className="text-2xl font-semibold mb-4">Corporate Network / Firewall</h2>
        <p className="text-muted-foreground mb-4">
          Company networks often block device-to-device traffic. The relay route needs only
          outbound HTTPS/WebSocket (<code>wss://</code>) from both your phone and your Mac, which
          most firewalls allow.
        </p>
        <ul className="text-muted-foreground space-y-2 mb-4">
          <li>• Configure a relay in <code>~/.broski/link/config.json</code> so the phone has a route that does not depend on the local network.</li>
          <li>• Make sure outbound <code>wss://</code> to the relay host is allowed on the network your Mac is on.</li>
        </ul>
      </section>

      {/* VPN */}
      <section className="mb-12">
        <h2 id="vpn-conflicts" className="text-2xl font-semibold mb-4">VPN Conflicts</h2>
        <p className="text-muted-foreground mb-4">
          A VPN on the phone or the Mac can hide the local network from the other device. Broski
          then falls back to the relay.
        </p>
        <ul className="text-muted-foreground space-y-2">
          <li>• Pause the VPN on the phone to test whether the local route works.</li>
          <li>• Allow local network access in the VPN app if it has that option.</li>
          <li>• Keep the relay configured so the connection works either way.</li>
        </ul>
      </section>

      {/* Relay */}
      <section className="mb-12">
        <h2 id="relay-issues" className="text-2xl font-semibold mb-4">Relay Issues</h2>
        <SimpleTable
          headers={["Symptom", "Check", "Fix"]}
          rows={[
            ["Relay shows as not connected", "broski-link status", "Check the relay URL in ~/.broski/link/config.json, then broski restart"],
            ["Phone cannot use the relay", "QR code was created before the relay was configured", "Run broski-link pair and scan the new code"],
            ["Machine shows as asleep", "The Mac went to sleep", "Wake it, or keep it awake while you are away"],
          ]}
        />
      </section>

      {/* Testing */}
      <section className="mb-12">
        <h2 id="testing" className="text-2xl font-semibold mb-4">Testing Connectivity</h2>
        <CodeBlock language="bash">{`# Is the service running?
broski status

# Is the Link port listening? (default 18275)
lsof -nP -iTCP:18275 -sTCP:LISTEN

# Watch the link log
tail -f ~/.broski/logs/link.log`}</CodeBlock>
      </section>

      {/* Connection Drops */}
      <section className="mb-12">
        <h2 id="connection-drops" className="text-2xl font-semibold mb-4">Connection Drops</h2>
        <SimpleTable
          headers={["Cause", "What happens", "Fix"]}
          rows={[
            ["Phone switches networks", "The app reconnects on its own", "Wait a few seconds"],
            ["Mac sleeps", "The machine shows as asleep", "Keep the Mac awake while you work"],
            ["Weak WiFi", "Frequent reconnects", "Move closer to the router or use a wired connection"],
          ]}
        />
      </section>

      {/* Next Steps */}
      <section className="mt-12 pt-8 border-t border-border">
        <h2 id="next-steps" className="text-lg font-semibold mb-4">Related</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/bridge/remote-access" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Remote Access</h3>
            <p className="text-sm text-muted-foreground">Set up a relay</p>
          </a>
          <a href="/docs/troubleshooting/connection" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Connection Issues</h3>
            <p className="text-sm text-muted-foreground">General connection troubleshooting</p>
          </a>
        </div>
      </section>
    </article>
  );
}
