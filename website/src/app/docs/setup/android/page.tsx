import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CodeBlock } from "@/components/docs/code-block";
import { Callout } from "@/components/docs/callout";
import { SimpleTable } from "@/components/docs/docs-table";
import { Steps, SuccessStep } from "@/components/docs/steps";

export const metadata: Metadata = {
  title: "Android Setup - Broski",
  description: "Set up Broski on your Android phone or tablet",
};

export default function AndroidSetupPage() {
  notFound();

  return (
    <article className="max-w-3xl">
      <h1 className="text-4xl font-bold mb-4">Android Setup</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Set up Broski on your Android phone or tablet.
      </p>

      {/* Requirements */}
      <section className="mb-12">
        <h2 id="requirements" className="text-2xl font-semibold mb-4">Requirements</h2>
        
        <SimpleTable
          headers={["Requirement", "Minimum", "Recommended"]}
          rows={[
            ["Android Version", "8.0 (API 26)", "12.0+"],
            ["Storage", "50 MB", "100 MB"],
            ["Architecture", "arm64-v8a, armeabi-v7a, x86_64", "arm64-v8a"],
          ]}
        />

        <Callout type="info" title="Supported Devices">
          Broski supports all Android devices running Android 8.0 (Oreo) or later.
          This includes most phones manufactured since 2018.
        </Callout>
      </section>

      {/* Download - Play Store */}
      <section className="mb-12">
        <h2 id="download" className="text-2xl font-semibold mb-4">Download from Play Store</h2>
        
        <div className="bg-card/50 border border-border/50 rounded-lg p-6 text-center mb-6">
          <div className="mb-4">
            <svg className="w-16 h-16 mx-auto text-primary" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3,20.5V3.5C3,2.91 3.34,2.39 3.84,2.15L13.69,12L3.84,21.85C3.34,21.6 3,21.09 3,20.5M16.81,15.12L6.05,21.34L14.54,12.85L16.81,15.12M20.16,10.81C20.5,11.08 20.75,11.5 20.75,12C20.75,12.5 20.5,12.92 20.16,13.19L17.89,14.5L15.39,12L17.89,9.5L20.16,10.81M6.05,2.66L16.81,8.88L14.54,11.15L6.05,2.66Z"/>
            </svg>
          </div>
          <a 
            href="https://play.google.com/store/apps/details?id=com.broski"
            className="inline-block bg-primary text-primary-foreground px-6 py-3 rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            Get it on Google Play
          </a>
          <p className="text-sm text-muted-foreground mt-3">Requires Android 8.0+ &bull; Subscription required</p>
        </div>
      </section>

      {/* APK Sideload */}
      <section className="mb-12">
        <h2 id="apk-sideload" className="text-2xl font-semibold mb-4">APK Sideload (Alternative)</h2>
        <p className="text-muted-foreground mb-4">
          For devices without Google Play Store access, or if you prefer manual installation:
        </p>

        <Steps
          steps={[
            {
              title: "Download the APK",
              description: (
                <span>
                  Download the latest APK from the official Broski website at{" "}
                  <a href="https://broskiapp.com" className="text-primary hover:underline">
                    broskiapp.com
                  </a>.
                </span>
              ),
            },
            {
              title: "Enable Unknown Sources",
              description: "Go to Settings > Security > Install unknown apps, and enable it for your browser or file manager.",
            },
            {
              title: "Install the APK",
              description: "Open the downloaded APK file and tap \"Install\" when prompted.",
            },
            {
              title: "Disable Unknown Sources",
              description: "For security, disable \"Install unknown apps\" after installation.",
            },
          ]}
        />

        <Callout type="warning" title="Security Note">
          Only download APKs from official sources (broskiapp.com). Third-party APK sites 
          may distribute modified or malicious versions.
        </Callout>
      </section>

      {/* Required Permissions */}
      <section className="mb-12">
        <h2 id="permissions" className="text-2xl font-semibold mb-4">Required Permissions</h2>
        <p className="text-muted-foreground mb-4">
          Broski requests only the permissions it needs. Here&apos;s what each one is for:
        </p>

        <SimpleTable
          headers={["Permission", "Purpose", "Required"]}
          rows={[
            [
              <strong key="camera">Camera</strong>,
              "Scan QR code to connect to your computer",
              "Yes"
            ],
            [
              <strong key="internet">Internet</strong>,
              "Connect to your computer over the local network or a relay",
              "Yes"
            ],
            [
              <strong key="network">Network State</strong>,
              "Detect WiFi/cellular and connection quality",
              "Yes"
            ],
            [
              <strong key="notifications">Notifications</strong>,
              "Alert when AI needs approval or tasks complete",
              "Optional"
            ],
            [
              <strong key="storage">Storage</strong>,
              "Attach files and images to conversations",
              "Optional"
            ],
          ]}
        />
      </section>

      {/* Battery Optimization */}
      <section className="mb-12">
        <h2 id="battery-optimization" className="text-2xl font-semibold mb-4">Battery Optimization</h2>
        <p className="text-muted-foreground mb-4">
          Android aggressively kills background apps to save battery. To ensure reliable connections, 
          disable battery optimization for Broski:
        </p>

        <h3 id="disable-optimization" className="text-lg font-semibold mb-3">Disable Battery Optimization</h3>
        <ol className="text-muted-foreground space-y-2 ml-4 list-decimal mb-4">
          <li>Open <strong className="text-foreground">Settings</strong></li>
          <li>Tap <strong className="text-foreground">Apps</strong> (or &quot;Applications&quot;)</li>
          <li>Find and tap <strong className="text-foreground">Broski</strong></li>
          <li>Tap <strong className="text-foreground">Battery</strong></li>
          <li>Select <strong className="text-foreground">&quot;Unrestricted&quot;</strong> or &quot;Don&apos;t optimize&quot;</li>
        </ol>

        <Callout type="tip" title="Manufacturer-Specific Settings">
          Some manufacturers (Samsung, Xiaomi, OnePlus, Huawei) have additional battery 
          optimization features. You may need to whitelist Broski in their specific settings 
          (e.g., &quot;Sleeping apps&quot;, &quot;Battery saver&quot;, &quot;Auto-launch&quot;).
        </Callout>

        <h3 id="samsung" className="text-lg font-semibold mb-3 mt-6">Samsung Devices</h3>
        <ol className="text-muted-foreground space-y-2 ml-4 list-decimal">
          <li>Settings &gt; Apps &gt; Broski &gt; Battery &gt; Unrestricted</li>
          <li>Settings &gt; Battery &gt; Background usage limits &gt; Never sleeping apps &gt; Add Broski</li>
          <li>Settings &gt; Device care &gt; Battery &gt; App power management &gt; Disable for Broski</li>
        </ol>

        <h3 id="xiaomi" className="text-lg font-semibold mb-3 mt-6">Xiaomi / MIUI Devices</h3>
        <ol className="text-muted-foreground space-y-2 ml-4 list-decimal">
          <li>Settings &gt; Apps &gt; Manage apps &gt; Broski &gt; Battery saver &gt; No restrictions</li>
          <li>Security app &gt; Permissions &gt; Autostart &gt; Enable Broski</li>
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
              title: "Scan QR Code",
              description: "Run broski-link pair on your computer and point your camera at the QR code in your terminal.",
            },
          ]}
        />

        <SuccessStep
          title="Connected!"
          description="You'll see your projects and can start chatting with your AI assistant."
        />
      </section>

      {/* Remote Access */}
      <section className="mb-12">
        <h2 id="remote-access" className="text-2xl font-semibold mb-4">Away From Home (Optional)</h2>
        <p className="text-muted-foreground mb-4">
          On your home network your Android device connects straight to your Mac. To reach it from anywhere, configure a
          relay on your Mac. No VPN or extra app is needed on your phone.
        </p>

        <Steps
          steps={[
            {
              title: "Add a relay on your Mac",
              description: "Put the relay URL in ~/.broski/link/config.json, then run broski restart.",
            },
            {
              title: "Pair again",
              description: "Run broski-link pair and scan the new QR code, which now includes the relay.",
            },
            {
              title: "Check the route",
              description: "broski-link status shows whether your phone is on the local network or the relay.",
            },
          ]}
        />
      </section>

      {/* Troubleshooting */}
      <section className="mb-12">
        <h2 id="troubleshooting" className="text-2xl font-semibold mb-4">Android-Specific Issues</h2>
        
        <div className="space-y-4">
          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Camera Permission Denied</h3>
            <p className="text-muted-foreground text-sm">
              Go to <strong className="text-foreground">Settings &gt; Apps &gt; Broski &gt; Permissions</strong>, 
              and enable Camera access.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Connection Drops Frequently</h3>
            <p className="text-muted-foreground text-sm">
              This is usually caused by battery optimization killing the app. Follow the 
              <a href="#battery-optimization" className="text-primary hover:underline"> Battery Optimization</a> section 
              to whitelist Broski.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">QR Code Not Scanning</h3>
            <p className="text-muted-foreground text-sm mb-2">
              Try these steps:
            </p>
            <ul className="text-muted-foreground text-sm space-y-1 ml-4 list-disc">
              <li>Increase terminal brightness</li>
              <li>Hold phone 6-12 inches from screen</li>
              <li>Clean your camera lens</li>
              <li>Tap &quot;Enter manually&quot; and type the IP address</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">App Crashes on Launch</h3>
            <p className="text-muted-foreground text-sm">
              Clear the app cache: <strong className="text-foreground">Settings &gt; Apps &gt; Broski &gt; Storage &gt; Clear Cache</strong>.
              If that doesn&apos;t help, try &quot;Clear Data&quot; (this will require reconnecting).
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">APK Won&apos;t Install</h3>
            <p className="text-muted-foreground text-sm">
              Make sure you&apos;ve enabled &quot;Install unknown apps&quot; for your file manager or browser.
              Also verify you downloaded the correct APK for your device architecture (most modern phones use arm64-v8a).
            </p>
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
              Reach your computer from anywhere with a relay
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
