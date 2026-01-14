import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";
import { Callout } from "@/components/docs/callout";

export const metadata: Metadata = {
  title: "Background Service - Broski",
  description: "Run the Broski bridge as a persistent background service that starts automatically on boot",
};

export default function BackgroundServicePage() {
  return (
    <article className="max-w-3xl">
      <h1 id="background-service" className="text-4xl font-bold mb-4">Background Service</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Run the Broski bridge as a persistent background service that starts automatically on boot.
      </p>

      {/* Overview */}
      <section className="mb-12">
        <h2 id="overview" className="text-2xl font-semibold mb-4">Overview</h2>
        <p className="text-muted-foreground mb-4">
          By default, the bridge runs in your terminal and stops when you close the window. 
          For always-on access, you can run the bridge as a background service (daemon) that:
        </p>
        <ul className="list-disc list-inside space-y-2 text-muted-foreground">
          <li>Starts automatically when your Mac boots</li>
          <li>Runs in the background without a terminal window</li>
          <li>Automatically restarts if it crashes</li>
          <li>Logs output to files for debugging</li>
        </ul>
      </section>

      {/* macOS LaunchAgent */}
      <section className="mb-12">
        <h2 id="macos-launchagent" className="text-2xl font-semibold mb-4">macOS LaunchAgent</h2>
        <p className="text-muted-foreground mb-4">
          On macOS, the recommended way to run the bridge as a service is using a LaunchAgent.
        </p>

        <h3 id="create-plist" className="text-xl font-medium mb-3 mt-6">1. Create the LaunchAgent plist</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Create a file at <code className="bg-muted/50 px-1 rounded">~/Library/LaunchAgents/com.broski.bridge.plist</code>:
        </p>
        <CodeBlock language="xml">{`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" 
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.broski.bridge</string>
    
    <key>ProgramArguments</key>
    <array>
        <string>/Users/YOUR_USERNAME/.bun/bin/bunx</string>
        <string>broski</string>
    </array>
    
    <key>RunAtLoad</key>
    <true/>
    
    <key>KeepAlive</key>
    <true/>
    
    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/.broski/broski.log</string>
    
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/.broski/broski.error.log</string>
    
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/Users/YOUR_USERNAME/.bun/bin</string>
    </dict>
</dict>
</plist>`}</CodeBlock>

        <Callout type="warning" title="Important">
          Replace YOUR_USERNAME with your actual macOS username.
        </Callout>

        <h3 id="load-service" className="text-xl font-medium mb-3 mt-6">2. Load the service</h3>
        <CodeBlock language="bash">{`# Load and start the service
launchctl load ~/Library/LaunchAgents/com.broski.bridge.plist

# Verify it's running
launchctl list | grep broski`}</CodeBlock>

        <h3 id="manage-service" className="text-xl font-medium mb-3 mt-6">3. Manage the service</h3>
        <CodeBlock language="bash">{`# Stop the service
launchctl stop com.broski.bridge

# Start the service
launchctl start com.broski.bridge

# Unload (disable) the service
launchctl unload ~/Library/LaunchAgents/com.broski.bridge.plist

# View logs
tail -f ~/.broski/broski.log
tail -f ~/.broski/broski.error.log`}</CodeBlock>
      </section>

      {/* With Tailscale Funnel */}
      <section className="mb-12">
        <h2 id="with-funnel" className="text-2xl font-semibold mb-4">With Tailscale Funnel</h2>
        <p className="text-muted-foreground mb-4">
          To enable Funnel in your background service, modify the ProgramArguments:
        </p>
        <CodeBlock language="xml">{`<key>ProgramArguments</key>
<array>
    <string>/Users/YOUR_USERNAME/.bun/bin/bunx</string>
    <string>broski</string>
    <string>--funnel</string>
</array>`}</CodeBlock>
      </section>

      {/* Linux systemd */}
      <section className="mb-12">
        <h2 id="linux-systemd" className="text-2xl font-semibold mb-4">Linux systemd</h2>
        <p className="text-muted-foreground mb-4">
          On Linux, use systemd to run the bridge as a user service.
        </p>

        <h3 id="create-service" className="text-xl font-medium mb-3 mt-6">1. Create the service file</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Create <code className="bg-muted/50 px-1 rounded">~/.config/systemd/user/broski.service</code>:
        </p>
        <CodeBlock language="ini">{`[Unit]
Description=Broski Bridge
After=network.target

[Service]
Type=simple
ExecStart=%h/.bun/bin/bunx broski
Restart=always
RestartSec=10
Environment="PATH=%h/.bun/bin:/usr/local/bin:/usr/bin:/bin"

[Install]
WantedBy=default.target`}</CodeBlock>

        <h3 id="enable-service" className="text-xl font-medium mb-3 mt-6">2. Enable and start</h3>
        <CodeBlock language="bash">{`# Reload systemd
systemctl --user daemon-reload

# Enable on boot
systemctl --user enable broski

# Start now
systemctl --user start broski

# Check status
systemctl --user status broski

# View logs
journalctl --user -u broski -f`}</CodeBlock>
      </section>

      {/* Troubleshooting */}
      <section className="mb-12">
        <h2 id="troubleshooting" className="text-2xl font-semibold mb-4">Troubleshooting</h2>
        
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Service not starting</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>Check logs: <code className="bg-muted/50 px-1 rounded">tail ~/.broski/broski.error.log</code></li>
              <li>Verify the path to bunx is correct</li>
              <li>Ensure broski is installed: <code className="bg-muted/50 px-1 rounded">bunx broski --help</code></li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Can&apos;t connect from phone</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>Run <code className="bg-muted/50 px-1 rounded">bunx broski doctor</code> to check status</li>
              <li>Verify the service is running</li>
              <li>Check firewall isn&apos;t blocking port 18274</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Viewing QR Code */}
      <section className="mb-12">
        <h2 id="viewing-qr-code" className="text-2xl font-semibold mb-4">Viewing the QR Code</h2>
        <p className="text-muted-foreground mb-4">
          When running as a background service, you can&apos;t see the QR code in a terminal. Options:
        </p>
        
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Option 1: Run temporarily in foreground</h3>
            <CodeBlock language="bash">{`# Stop the service temporarily
launchctl stop com.broski.bridge

# Run in foreground to see QR
bunx broski

# Scan QR, then Ctrl+C and restart service
launchctl start com.broski.bridge`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Option 2: Use saved connection</h3>
            <p className="text-sm text-muted-foreground">
              Once you&apos;ve scanned the QR code, your phone remembers the connection. 
              As long as the token in <code className="bg-muted/50 px-1 rounded">~/.broski/token</code> doesn&apos;t change, 
              the app will reconnect automatically.
            </p>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="mt-12 pt-8 border-t border-border">
        <h2 id="next-steps" className="text-lg font-semibold mb-4">Next Steps</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/bridge/remote-access" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Remote Access</h3>
            <p className="text-sm text-muted-foreground">Set up Tailscale for access from anywhere</p>
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
