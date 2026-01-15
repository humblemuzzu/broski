import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";
import { Callout } from "@/components/docs/callout";
import { SimpleTable } from "@/components/docs/docs-table";
import { Steps, SuccessStep } from "@/components/docs/steps";

export const metadata: Metadata = {
  title: "iOS Setup - Broski",
  description: "Set up Broski on your iPhone or iPad",
};

export default function IOSSetupPage() {
  return (
    <article className="max-w-3xl">
      <h1 className="text-4xl font-bold mb-4">iOS Setup</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Set up Broski on your iPhone or iPad.
      </p>

      {/* Requirements */}
      <section className="mb-12">
        <h2 id="requirements" className="text-2xl font-semibold mb-4">Requirements</h2>
        
        <SimpleTable
          headers={["Requirement", "Minimum", "Recommended"]}
          rows={[
            ["iOS Version", "15.0", "17.0+"],
            ["Device", "iPhone 8, iPad (6th gen)", "iPhone 12+, iPad (9th gen)+"],
            ["Storage", "50 MB", "100 MB"],
          ]}
        />

        <Callout type="info" title="Supported Devices">
          Broski supports all iPhones and iPads running iOS 15.0 or later. 
          This includes iPhone 8 and newer, and iPad (6th generation) and newer.
        </Callout>
      </section>

      {/* Download */}
      <section className="mb-12">
        <h2 id="download" className="text-2xl font-semibold mb-4">Download from App Store</h2>
        
        <div className="bg-card/50 border border-border/50 rounded-lg p-6 text-center mb-6">
          <div className="mb-4">
            <svg className="w-16 h-16 mx-auto text-primary" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
            </svg>
          </div>
          <a 
            href="https://apps.apple.com/app/broski"
            className="inline-block bg-primary text-primary-foreground px-6 py-3 rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            Download on the App Store
          </a>
          <p className="text-sm text-muted-foreground mt-3">Free - iOS 15.0+</p>
        </div>
      </section>

      {/* Required Permissions */}
      <section className="mb-12">
        <h2 id="permissions" className="text-2xl font-semibold mb-4">Required Permissions</h2>
        <p className="text-muted-foreground mb-4">
          Broski requests only the permissions it needs to function. Here&apos;s what each one is for:
        </p>

        <SimpleTable
          headers={["Permission", "Purpose", "Required"]}
          rows={[
            [
              <strong key="camera">Camera</strong>,
              "Scan QR code to connect to your Mac",
              "Yes"
            ],
            [
              <strong key="network">Local Network</strong>,
              "Connect to bridge server on your local WiFi",
              "Yes"
            ],
            [
              <strong key="notifications">Notifications</strong>,
              "Alert when AI needs approval or tasks complete",
              "Optional"
            ],
            [
              <strong key="photos">Photos</strong>,
              "Attach images to your AI conversations",
              "Optional"
            ],
          ]}
        />

        <Callout type="warning" title="Local Network Permission">
          If you deny the Local Network permission, you won&apos;t be able to connect to your Mac 
          over WiFi. You can still use Tailscale for remote connections.
        </Callout>

        <h3 id="granting-permissions" className="text-lg font-semibold mb-3 mt-6">Granting Permissions Later</h3>
        <p className="text-muted-foreground mb-2">
          If you accidentally denied a permission, you can grant it from Settings:
        </p>
        <ol className="text-muted-foreground space-y-2 ml-4 list-decimal">
          <li>Open <strong className="text-foreground">Settings</strong></li>
          <li>Scroll down and tap <strong className="text-foreground">Broski</strong></li>
          <li>Toggle on the permissions you need</li>
        </ol>
      </section>

      {/* First Launch */}
      <section className="mb-12">
        <h2 id="first-launch" className="text-2xl font-semibold mb-4">First Launch Walkthrough</h2>
        
        <Steps
          steps={[
            {
              title: "Welcome Screen",
              description: "You'll see a brief intro explaining what Broski does. Tap \"Get Started\" to continue.",
            },
            {
              title: "Camera Permission",
              description: "Broski will ask for camera access. Tap \"Allow\" to enable QR code scanning.",
            },
            {
              title: "Local Network Permission",
              description: "iOS will ask to allow Broski to find devices on your network. Tap \"Allow\" to connect to your Mac.",
            },
            {
              title: "Scan QR Code",
              description: "Point your camera at the QR code displayed in your terminal. Make sure the bridge is running.",
            },
          ]}
        />

        <SuccessStep
          title="Connected!"
          description="You'll see your projects and can start chatting with your AI assistant."
        />
      </section>

      {/* Tailscale Setup */}
      <section className="mb-12">
        <h2 id="tailscale" className="text-2xl font-semibold mb-4">Tailscale Setup (Optional)</h2>
        <p className="text-muted-foreground mb-4">
          For remote access outside your home network, install Tailscale on your iPhone:
        </p>

        <Steps
          steps={[
            {
              title: "Install Tailscale",
              description: (
                <span>
                  Download <a href="https://apps.apple.com/app/tailscale/id1470499037" className="text-primary hover:underline">Tailscale from the App Store</a>.
                </span>
              ),
            },
            {
              title: "Sign In",
              description: "Open Tailscale and sign in with the same account you use on your Mac.",
            },
            {
              title: "Enable VPN",
              description: "Tap \"Connect\" and allow Tailscale to add a VPN configuration.",
            },
            {
              title: "Verify Connection",
              description: "In Broski, your Mac should now be reachable via its Tailscale IP (100.x.x.x).",
            },
          ]}
        />

        <Callout type="tip" title="Always-On VPN">
          Enable &quot;Connect on demand&quot; in Tailscale settings to automatically connect when needed.
          This ensures Broski works even when you&apos;re away from home.
        </Callout>
      </section>

      {/* Troubleshooting */}
      <section className="mb-12">
        <h2 id="troubleshooting" className="text-2xl font-semibold mb-4">iOS-Specific Issues</h2>
        
        <div className="space-y-4">
          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Camera Permission Denied</h3>
            <p className="text-muted-foreground text-sm">
              Go to <strong className="text-foreground">Settings &gt; Privacy &amp; Security &gt; Camera</strong>, 
              find Broski, and enable camera access.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Local Network Permission Denied</h3>
            <p className="text-muted-foreground text-sm">
              Go to <strong className="text-foreground">Settings &gt; Privacy &amp; Security &gt; Local Network</strong>, 
              find Broski, and enable local network access. You may need to restart the app.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Connection Drops in Background</h3>
            <p className="text-muted-foreground text-sm">
              iOS may suspend background apps to save battery. Keep Broski in the foreground during 
              active sessions, or enable notifications to be alerted when AI needs attention.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">QR Code Not Scanning</h3>
            <p className="text-muted-foreground text-sm mb-2">
              Try these steps:
            </p>
            <ul className="text-muted-foreground text-sm space-y-1 ml-4 list-disc">
              <li>Increase terminal brightness/contrast</li>
              <li>Hold phone 6-12 inches from screen</li>
              <li>Clean your camera lens</li>
              <li>Tap &quot;Enter manually&quot; and type the IP address</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section>
        <h2 id="next-steps" className="text-2xl font-semibold mb-4">Next Steps</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <a 
            href="/docs/bridge/remote-access"
            className="block p-4 border border-border/50 rounded-lg hover:border-primary/50 transition-colors"
          >
            <h3 className="font-semibold mb-1">Remote Access &rarr;</h3>
            <p className="text-muted-foreground text-sm">
              Set up Tailscale for access from anywhere
            </p>
          </a>
          <a 
            href="/docs/troubleshooting"
            className="block p-4 border border-border/50 rounded-lg hover:border-primary/50 transition-colors"
          >
            <h3 className="font-semibold mb-1">Troubleshooting &rarr;</h3>
            <p className="text-muted-foreground text-sm">
              Solutions to common connection issues
            </p>
          </a>
        </div>
      </section>
    </article>
  );
}
