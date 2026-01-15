import type { Metadata } from "next";
import { CodeBlock, Callout, SimpleTable, Steps } from "@/components/docs";

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
          <li>Starts automatically when your computer boots</li>
          <li>Runs in the background without a terminal window</li>
          <li>Automatically restarts if it crashes</li>
          <li>Logs output to files for debugging</li>
        </ul>
      </section>

      {/* Quick Setup */}
      <section className="mb-12">
        <h2 id="quick-setup" className="text-2xl font-semibold mb-4">Quick Setup (Recommended)</h2>
        <p className="text-muted-foreground mb-4">
          The easiest way to set up the bridge as a background service:
        </p>
        
        <CodeBlock language="bash">{`# Install as background service
bunx broski install

# Check status
bunx broski status

# View QR code to pair your phone
bunx broski qr

# Stop the service
bunx broski stop

# Remove the service
bunx broski uninstall`}</CodeBlock>

        <Callout type="tip" title="Recommended Workflow">
          Use <code>broski install</code> once, then use <code>broski qr</code> to get the QR code 
          whenever you need to pair a new device. The service keeps running in the background.
        </Callout>
      </section>

      {/* macOS LaunchAgent */}
      <section className="mb-12">
        <h2 id="macos-launchagent" className="text-2xl font-semibold mb-4">macOS LaunchAgent</h2>
        <p className="text-muted-foreground mb-4">
          On macOS, the recommended way to run the bridge as a service is using a LaunchAgent.
          The <code>broski install</code> command creates this for you, but here&apos;s the manual setup:
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
          Replace <code>YOUR_USERNAME</code> with your actual macOS username. 
          Find it with: <code>whoami</code>
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

      {/* macOS Homebrew Services */}
      <section className="mb-12">
        <h2 id="homebrew-services" className="text-2xl font-semibold mb-4">macOS Homebrew Services (Alternative)</h2>
        <p className="text-muted-foreground mb-4">
          If you installed Broski via Homebrew, you can use Homebrew services:
        </p>
        
        <CodeBlock language="bash">{`# Install broski (if not already)
brew install broski

# Start as background service
brew services start broski

# Check status
brew services list | grep broski

# Stop the service
brew services stop broski

# Restart the service
brew services restart broski`}</CodeBlock>
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

        <p className="text-sm text-muted-foreground mt-3">
          Or set the environment variable:
        </p>
        <CodeBlock language="xml">{`<key>EnvironmentVariables</key>
<dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/Users/YOUR_USERNAME/.bun/bin</string>
    <key>BROSKI_ENABLE_FUNNEL</key>
    <string>1</string>
</dict>`}</CodeBlock>
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
        <CodeBlock language="bash">{`# Create config directory if needed
mkdir -p ~/.config/systemd/user

# Reload systemd
systemctl --user daemon-reload

# Enable on boot
systemctl --user enable broski

# Start now
systemctl --user start broski

# Check status
systemctl --user status broski

# View logs
journalctl --user -u broski -f`}</CodeBlock>

        <h3 id="linux-manage" className="text-xl font-medium mb-3 mt-6">3. Manage the service</h3>
        <CodeBlock language="bash">{`# Stop the service
systemctl --user stop broski

# Restart the service
systemctl --user restart broski

# Disable auto-start
systemctl --user disable broski`}</CodeBlock>

        <Callout type="info" title="Enable lingering">
          For the service to run after you log out, enable lingering:
          <CodeBlock language="bash">{`loginctl enable-linger $USER`}</CodeBlock>
        </Callout>
      </section>

      {/* Windows Task Scheduler */}
      <section className="mb-12">
        <h2 id="windows-task-scheduler" className="text-2xl font-semibold mb-4">Windows Task Scheduler</h2>
        <p className="text-muted-foreground mb-4">
          On Windows, use Task Scheduler to run the bridge automatically.
        </p>

        <h3 id="windows-gui" className="text-xl font-medium mb-3 mt-6">Method 1: Task Scheduler GUI</h3>
        <Steps
          steps={[
            { title: "Open Task Scheduler", description: "Press Win+R, type taskschd.msc, press Enter" },
            { title: "Create Basic Task", description: "Click 'Create Basic Task' in the right panel" },
            { title: "Name the task", description: "Name: 'Broski Bridge', Description: 'Broski bridge server'" },
            { title: "Set trigger", description: "Choose 'When I log on'" },
            { title: "Set action", description: "Choose 'Start a program'" },
            { title: "Configure program", description: "Program: %USERPROFILE%\\.bun\\bin\\bunx.cmd, Arguments: broski" },
            { title: "Configure options", description: "Check 'Open the Properties dialog' and click Finish" },
            { title: "Set to run hidden", description: "In Properties > General, check 'Run whether user is logged on or not'" },
          ]}
        />

        <h3 id="windows-powershell" className="text-xl font-medium mb-3 mt-6">Method 2: PowerShell (Command Line)</h3>
        <CodeBlock language="powershell">{`# Create scheduled task
$action = New-ScheduledTaskAction -Execute "$env:USERPROFILE\\.bun\\bin\\bunx.cmd" -Argument "broski"
$trigger = New-ScheduledTaskTrigger -AtLogon
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Limited

Register-ScheduledTask -TaskName "Broski Bridge" -Action $action -Trigger $trigger -Settings $settings -Principal $principal

# Check status
Get-ScheduledTask -TaskName "Broski Bridge"

# Start manually
Start-ScheduledTask -TaskName "Broski Bridge"

# Stop
Stop-ScheduledTask -TaskName "Broski Bridge"

# Remove
Unregister-ScheduledTask -TaskName "Broski Bridge" -Confirm:$false`}</CodeBlock>

        <h3 id="windows-logs" className="text-xl font-medium mb-3 mt-6">Windows Log Location</h3>
        <p className="text-muted-foreground mb-3">
          To capture logs on Windows, modify the task to redirect output:
        </p>
        <CodeBlock language="powershell">{`# Create a batch script at %USERPROFILE%\\broski-start.bat
@echo off
%USERPROFILE%\\.bun\\bin\\bunx.cmd broski >> %USERPROFILE%\\.broski\\broski.log 2>&1`}</CodeBlock>
        <p className="text-sm text-muted-foreground mt-2">
          Then point the scheduled task to this batch script instead.
        </p>
      </section>

      {/* Log Locations */}
      <section className="mb-12">
        <h2 id="log-locations" className="text-2xl font-semibold mb-4">Log File Locations</h2>
        
        <SimpleTable
          headers={["Platform", "Standard Output", "Error Output"]}
          rows={[
            ["macOS (LaunchAgent)", "~/.broski/broski.log", "~/.broski/broski.error.log"],
            ["macOS (Homebrew)", "/usr/local/var/log/broski.log", "/usr/local/var/log/broski.error.log"],
            ["Linux (systemd)", "journalctl --user -u broski", "journalctl --user -u broski"],
            ["Windows", "%USERPROFILE%\\.broski\\broski.log", "(combined with stdout)"],
          ]}
        />

        <h3 className="text-lg font-medium mt-6 mb-3">View Logs</h3>
        <CodeBlock language="bash">{`# macOS
tail -f ~/.broski/broski.log

# Linux
journalctl --user -u broski -f

# Windows (PowerShell)
Get-Content -Path "$env:USERPROFILE\\.broski\\broski.log" -Wait`}</CodeBlock>
      </section>

      {/* Auto-Restart on Failure */}
      <section className="mb-12">
        <h2 id="auto-restart" className="text-2xl font-semibold mb-4">Auto-Restart on Failure</h2>
        <p className="text-muted-foreground mb-4">
          Configure automatic restart when the bridge crashes:
        </p>

        <h3 className="text-lg font-medium mb-3">macOS (LaunchAgent)</h3>
        <p className="text-sm text-muted-foreground mb-2">
          Add these keys to your plist for automatic restart:
        </p>
        <CodeBlock language="xml">{`<!-- Restart immediately on crash -->
<key>KeepAlive</key>
<true/>

<!-- Or restart only on crash (not clean exit) -->
<key>KeepAlive</key>
<dict>
    <key>SuccessfulExit</key>
    <false/>
</dict>

<!-- Throttle restarts (wait 10 seconds between restart attempts) -->
<key>ThrottleInterval</key>
<integer>10</integer>`}</CodeBlock>

        <h3 className="text-lg font-medium mb-3 mt-6">Linux (systemd)</h3>
        <CodeBlock language="ini">{`[Service]
# Restart on failure
Restart=on-failure
# Wait 10 seconds before restarting
RestartSec=10
# Give up after 5 failures in 5 minutes
StartLimitIntervalSec=300
StartLimitBurst=5`}</CodeBlock>

        <h3 className="text-lg font-medium mb-3 mt-6">Windows (Task Scheduler)</h3>
        <p className="text-sm text-muted-foreground mb-2">
          In Task Properties &gt; Settings:
        </p>
        <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
          <li>Check &quot;If the task fails, restart every:&quot; and set to 1 minute</li>
          <li>Set &quot;Attempt to restart up to:&quot; to 3 times</li>
          <li>Check &quot;Run task as soon as possible after a scheduled start is missed&quot;</li>
        </ul>
      </section>

      {/* Checking Service Status */}
      <section className="mb-12">
        <h2 id="status-commands" className="text-2xl font-semibold mb-4">Checking Service Status</h2>
        
        <SimpleTable
          headers={["Platform", "Check Status Command"]}
          rows={[
            ["All platforms (recommended)", "bunx broski status"],
            ["macOS (LaunchAgent)", "launchctl list | grep broski"],
            ["macOS (Homebrew)", "brew services list | grep broski"],
            ["Linux (systemd)", "systemctl --user status broski"],
            ["Windows", "Get-ScheduledTask -TaskName 'Broski Bridge'"],
          ]}
        />
      </section>

      {/* Viewing QR Code */}
      <section className="mb-12">
        <h2 id="viewing-qr-code" className="text-2xl font-semibold mb-4">Viewing the QR Code</h2>
        <p className="text-muted-foreground mb-4">
          When running as a background service, you can&apos;t see the QR code in a terminal. Options:
        </p>
        
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Option 1: Use the qr command (Recommended)</h3>
            <CodeBlock language="bash">{`bunx broski qr`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-2">
              Shows the QR code while the background service is running.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Option 2: Run temporarily in foreground</h3>
            <CodeBlock language="bash">{`# Stop the service temporarily
bunx broski stop

# Run in foreground to see QR
bunx broski

# Scan QR, then Ctrl+C and restart service
bunx broski install`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Option 3: Use saved connection</h3>
            <p className="text-sm text-muted-foreground">
              Once you&apos;ve scanned the QR code, your phone remembers the connection. 
              As long as the token in <code className="bg-muted/50 px-1 rounded">~/.broski/token</code> doesn&apos;t change, 
              the app will reconnect automatically.
            </p>
          </div>
        </div>
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
              <li>Run <code className="bg-muted/50 px-1 rounded">broski doctor</code> to check requirements</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Can&apos;t connect from phone</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>Run <code className="bg-muted/50 px-1 rounded">bunx broski status</code> to check if running</li>
              <li>Verify the service is running in logs</li>
              <li>Check firewall isn&apos;t blocking port 18274</li>
              <li>Try <code className="bg-muted/50 px-1 rounded">bunx broski qr</code> to get current QR code</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Service keeps restarting</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>Check error logs for crash reason</li>
              <li>Verify OpenCode is installed: <code className="bg-muted/50 px-1 rounded">opencode --version</code></li>
              <li>Check if port 18274 is in use by another process</li>
              <li>Try running manually first: <code className="bg-muted/50 px-1 rounded">bunx broski --verbose</code></li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Permission denied errors</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>Ensure the service runs as your user, not root</li>
              <li>Check file permissions on <code className="bg-muted/50 px-1 rounded">~/.broski/</code></li>
              <li>Verify bunx is executable: <code className="bg-muted/50 px-1 rounded">ls -la ~/.bun/bin/bunx</code></li>
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
