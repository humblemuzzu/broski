import type { Metadata } from "next";
import { CardGrid, Card } from "@/components/docs";

export const metadata: Metadata = {
  title: "Privacy & Security - Broski",
  description: "How Broski protects your code and data",
};

export default function PrivacySecurityPage() {
  return (
    <article className="max-w-3xl">
      <h1 id="privacy-security" className="text-4xl font-bold mb-4">
        Privacy &amp; Security
      </h1>
      <p className="text-xl text-muted-foreground mb-8">
        This page has moved. Our security documentation now has its own
        dedicated section with comprehensive details.
      </p>

      <section className="mb-12">
        <div className="bg-muted/30 border border-border rounded-lg p-5 mb-8">
          <h2 className="text-lg font-semibold mb-3">The Short Version</h2>
          <ul className="space-y-2 text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5 shrink-0">&#10003;</span>
              <span>
                <strong className="text-foreground">No cloud servers.</strong>{" "}
                Your phone connects directly to your system.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5 shrink-0">&#10003;</span>
              <span>
                <strong className="text-foreground">No telemetry.</strong> Zero
                analytics, zero tracking, zero crash reporting.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5 shrink-0">&#10003;</span>
              <span>
                <strong className="text-foreground">
                  Encrypted everything.
                </strong>{" "}
                TLS + certificate pinning on local, WireGuard on Tailscale.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5 shrink-0">&#10003;</span>
              <span>
                <strong className="text-foreground">
                  Your code stays yours.
                </strong>{" "}
                Conversations, files, and terminal output never leave your
                network.
              </span>
            </li>
          </ul>
        </div>

        <CardGrid>
          <Card
            href="/docs/security"
            title="Security & Privacy (Full)"
            description="Architecture, encryption, authentication, filesystem protection, and more."
          />
          <Card
            href="/legal/privacy"
            title="Privacy Policy"
            description="Full legal privacy policy."
          />
        </CardGrid>
      </section>
    </article>
  );
}
