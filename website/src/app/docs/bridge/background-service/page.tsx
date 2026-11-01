import type { Metadata } from "next";
import { CodeBlock, Callout, SimpleTable } from "@/components/docs";

export const metadata: Metadata = {
  title: "Background Service - Broski",
  description: "Run Broski Link as a background service that starts automatically on login",
};

export default function BackgroundServicePage() {
  return (
    <article className="max-w-3xl">
      <h1 id="background-service" className="text-4xl font-bold mb-4">Background Service</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Run Broski Link as a background service that starts automatically when you log in.
      </p>

      {/* Overview */}
      <section className="mb-12">
        <h2 id="overview" className="text-2xl font-semibold mb-4">Overview</h2>
        <p className="text-muted-foreground mb-4">
          Running <code>broski</code> in a terminal works, but it stops when you close the window.
          <code> broski install</code> registers <code>broski-link</code> as a service that:
        </p>
        <ul className="list-disc list-inside space-y-2 text-muted-foreground">
          <li>Starts automatically when you log in</li>
          <li>Starts the bridge for you and restarts it if it crashes</li>
          <li>Accepts connections from your paired phones, directly or through a relay</li>
          <li>Logs output to files for debugging</li>
        </ul>
        <Callout type="info" title="macOS and Linux">
          The service uses launchd on macOS and a systemd user service on Linux. Windows is not supported.
        </Callout>
      </section>

      {/* Quick Setup */}
      <section className="mb-12">
        <h2 id="quick-setup" className="text-2xl font-semibold mb-4">Quick Setup</h2>

        <CodeBlock language="bash">{`# Install and start the service
broski install

# Check status
broski status
broski-link status

# Show a QR code to pair your phone
broski-link pair

# Restart after changing ~/.broski/link/config.json
broski restart

# Stop the service
broski stop

# Remove the service
broski uninstall`}</CodeBlock>

        <Callout type="tip" title="Recommended Workflow">
          Run <code>broski install</code> once, then use <code>broski-link pair</code> whenever you need
          to pair a new device. The service keeps running in the background.
        </Callout>
      </section>

      {/* What gets installed */}
      <section className="mb-12">
        <h2 id="what-gets-installed" className="text-2xl font-semibold mb-4">What Gets Installed</h2>
        <SimpleTable
          headers={["Platform", "Service", "Definition"]}
          rows={[
            ["macOS", "LaunchAgent com.broski.link", "~/Library/LaunchAgents/com.broski.link.plist"],
            ["Linux", "systemd user service broski-link", "~/.config/systemd/user/broski-link.service"],
          ]}
        />

        <Callout type="info" title="Linux: keep it running after you log out">
          For the service to run after you log out, enable lingering:
          <CodeBlock language="bash">{`loginctl enable-linger $USER`}</CodeBlock>
        </Callout>
      </section>

      {/* Log Locations */}
      <section className="mb-12">
        <h2 id="log-locations" className="text-2xl font-semibold mb-4">Log File Locations</h2>

        <SimpleTable
          headers={["File", "Contents"]}
          rows={[
            ["~/.broski/logs/link.log", "broski-link output: pairing, routes, relay, bridge supervision"],
            ["~/.broski/logs/bridge.log", "Bridge standard output"],
            ["~/.broski/logs/bridge.error.log", "Bridge error output"],
          ]}
        />

        <h3 className="text-lg font-medium mt-6 mb-3">View Logs</h3>
        <CodeBlock language="bash">{`# Follow the bridge logs
broski logs --follow

# Follow the link log
tail -f ~/.broski/logs/link.log

# Linux (systemd journal)
journalctl --user -u broski-link -f`}</CodeBlock>
      </section>

      {/* Auto-Restart */}
      <section className="mb-12">
        <h2 id="auto-restart" className="text-2xl font-semibold mb-4">Automatic Restarts</h2>
        <p className="text-muted-foreground mb-4">
          Two layers keep things running:
        </p>
        <ul className="list-disc list-inside space-y-2 text-muted-foreground">
          <li><code>broski-link</code> restarts the bridge 1 to 30 seconds after it exits, and shows <code>crashed</code> with the reason in <code>broski-link status</code>.</li>
          <li>launchd (macOS) or systemd (Linux) restarts <code>broski-link</code> itself if it exits.</li>
        </ul>
      </section>

      {/* Viewing QR Code */}
      <section className="mb-12">
        <h2 id="viewing-qr-code" className="text-2xl font-semibold mb-4">Pairing a Phone</h2>
        <p className="text-muted-foreground mb-4">
          A background service has no terminal to show a QR code, so ask it for one:
        </p>
        <CodeBlock language="bash">{`broski-link pair`}</CodeBlock>
        <p className="text-sm text-muted-foreground mt-2">
          The code is single-use and expires after 10 minutes. Once a phone is paired it reconnects on its
          own; you do not need to scan again.
        </p>
      </section>

      {/* Troubleshooting */}
      <section className="mb-12">
        <h2 id="troubleshooting" className="text-2xl font-semibold mb-4">Troubleshooting</h2>

        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Service not starting</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>Check logs: <code className="bg-muted/50 px-1 rounded">tail ~/.broski/logs/link.log</code></li>
              <li>Ensure the <code className="bg-muted/50 px-1 rounded">broski-link</code> binary is installed next to <code className="bg-muted/50 px-1 rounded">broski</code></li>
              <li>Run <code className="bg-muted/50 px-1 rounded">broski doctor</code> to check requirements</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Can&apos;t connect from phone</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>Run <code className="bg-muted/50 px-1 rounded">broski status</code> and <code className="bg-muted/50 px-1 rounded">broski-link status</code></li>
              <li>Check the firewall isn&apos;t blocking the Broski Link port (default 18275)</li>
              <li>Run <code className="bg-muted/50 px-1 rounded">broski-link pair</code> for a fresh QR code</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Bridge keeps restarting</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>Check <code className="bg-muted/50 px-1 rounded">~/.broski/logs/bridge.error.log</code> for the crash reason</li>
              <li>Verify an agent is installed: <code className="bg-muted/50 px-1 rounded">claude --version</code> or <code className="bg-muted/50 px-1 rounded">pi --version</code></li>
              <li>Check if port 18274 is in use by another process</li>
              <li>Try running manually first: <code className="bg-muted/50 px-1 rounded">broski</code> in a terminal</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Permission denied errors</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>Ensure the service runs as your user, not root</li>
              <li>Check file permissions on <code className="bg-muted/50 px-1 rounded">~/.broski/</code></li>
              <li>Verify broski is executable: <code className="bg-muted/50 px-1 rounded">ls -la ~/.broski/bin/broski</code></li>
            </ul>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="mt-12 pt-8 border-t border-border">
        <h2 id="next-steps" className="text-lg font-semibold mb-4">Next Steps</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/bridge/remote-access" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Remote Access</h3>
            <p className="text-sm text-muted-foreground">How phones reach your Mac, directly or through a relay</p>
          </a>
          <a href="/docs/troubleshooting" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Troubleshooting</h3>
            <p className="text-sm text-muted-foreground">Solve common issues</p>
          </a>
        </div>
      </section>
    </article>
  );
}
