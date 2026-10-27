import type { Metadata } from "next";
import { CodeBlock, Callout, SimpleTable, Steps } from "@/components/docs";

export const metadata: Metadata = {
  title: "Remote Access - Broski",
  description: "Reach your AI coding agents from anywhere with Broski Link",
};

export default function RemoteAccessPage() {
  return (
    <article className="max-w-3xl">
      <h1 id="remote-access" className="text-4xl font-bold mb-4">Remote Access</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Broski Link connects your phone to your Mac directly on your network, or through an
        end-to-end encrypted relay when you are away. No VPN and no port forwarding.
      </p>

      <section className="mb-12">
        <h2 id="how-it-works" className="text-2xl font-semibold mb-4">How It Works</h2>
        <p className="text-muted-foreground mb-4">
          The <code>broski-link</code> service runs on your Mac. It starts the bridge, restarts it
          if it crashes, and is the only process your phone talks to. The bridge itself listens on
          your Mac&apos;s loopback interface and a local socket only, so it is never exposed to your
          network.
        </p>

        <SimpleTable
          headers={["", "Local network", "Relay"]}
          rows={[
            ["Route", "Phone to your Mac directly", "Phone and Mac both connect out to a relay"],
            ["Encryption", "Noise, end to end", "Noise, end to end (the relay cannot decrypt it)"],
            ["Works from anywhere", "No (same network)", "Yes"],
            ["Needs a relay configured", "No", "Yes"],
            ["Phone app required", "Broski only", "Broski only"],
          ]}
        />

        <p className="text-muted-foreground mt-4">
          The phone tries the local addresses from the pairing QR first and falls back to the relay
          when none of them answer. You do not choose a route; Broski picks the one that works.
        </p>
      </section>

      <section className="mb-12">
        <h2 id="setup" className="text-2xl font-semibold mb-4">Setup</h2>

        <Steps
          steps={[
            {
              title: "Install the service on your Mac",
              description: "This registers broski-link with launchd (macOS) or systemd (Linux).",
              content: <CodeBlock language="bash">{`broski install`}</CodeBlock>,
            },
            {
              title: "Show a pairing QR code",
              description: "The code is single-use and expires after 10 minutes.",
              content: <CodeBlock language="bash">{`broski-link pair`}</CodeBlock>,
            },
            {
              title: "Scan it with the Broski app",
              description: "The app stores the pairing and reconnects on its own from then on.",
            },
          ]}
        />

        <Callout type="info" title="Windows">
          Broski Link is not supported on Windows yet.
        </Callout>
      </section>

      <section className="mb-12">
        <h2 id="relay" className="text-2xl font-semibold mb-4">Using a Relay</h2>
        <p className="text-muted-foreground mb-4">
          A relay lets your phone reach your Mac when they are not on the same network. Point the
          service at one by adding its URL to <code>~/.broski/link/config.json</code> on your Mac:
        </p>
        <CodeBlock language="json">{`{
  "relay": "wss://relay.example.com"
}`}</CodeBlock>
        <p className="text-muted-foreground mt-4 mb-4">
          Restart the service, then run <code>broski-link pair</code> again. Pairing QR codes
          include the relay address, so phones paired afterwards can use it.
        </p>
        <CodeBlock language="bash">{`broski restart
broski-link pair`}</CodeBlock>

        <Callout type="note" title="What a relay can see">
          A relay forwards encrypted frames between your phone and your Mac. It sees device and
          machine ids, connection timing and message sizes, plus notification metadata when you
          enable notifications. It never sees prompts, code, files or conversations.
        </Callout>
      </section>

      <section className="mb-12">
        <h2 id="check-status" className="text-2xl font-semibold mb-4">Check the Connection</h2>
        <CodeBlock language="bash">{`# Machine, bridge, relay and session status
broski-link status

# Paired phones
broski-link devices

# Remove a phone (use at least the first 8 characters of its id)
broski-link revoke <device id prefix>`}</CodeBlock>
        <p className="text-muted-foreground mt-4">
          <code>broski-link status</code> shows whether the bridge is up, whether the relay is
          connected, and which route each paired phone is using.
        </p>
      </section>

      <section className="mb-12">
        <h2 id="lid-closed" className="text-2xl font-semibold mb-4">Keeping Your Mac Reachable</h2>
        <p className="text-muted-foreground mb-4">
          Your Mac has to be awake for the phone to reach it. If you use a Mac laptop with the lid
          closed, a keep-awake tool such as Amphetamine keeps it running.
        </p>
      </section>

      <section className="mt-12 pt-8 border-t border-border">
        <h2 id="next-steps" className="text-lg font-semibold mb-4">Next Steps</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/bridge/background-service" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Background Service</h3>
            <p className="text-sm text-muted-foreground">Run Broski Link automatically when you log in</p>
          </a>
          <a href="/docs/troubleshooting/network" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Network Troubleshooting</h3>
            <p className="text-sm text-muted-foreground">Solve pairing, firewall, and connection issues</p>
          </a>
        </div>
      </section>
    </article>
  );
}
