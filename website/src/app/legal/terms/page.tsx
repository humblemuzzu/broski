import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service - Broski",
  description: "Broski Terms of Service - Usage terms and conditions",
};

export default function TermsOfServicePage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
      <p className="text-muted-foreground mb-8">
        Effective: February 13, 2026 | Last updated: February 13, 2026
      </p>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">1. Agreement to Terms</h2>
        <p className="text-muted-foreground leading-relaxed">
          By downloading, installing, or using the Broski mobile application
          (&quot;App&quot;), you agree to be bound by these Terms of Service
          (&quot;Terms&quot;) and our{" "}
          <a href="/legal/privacy" className="text-primary hover:underline">
            Privacy Policy
          </a>
          . If you do not agree, do not use the App.
        </p>
        <p className="text-muted-foreground leading-relaxed mt-4">
          These Terms are between you and humblemuzzu, operating as Broski
          (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;).
        </p>
        <div className="bg-card/50 border border-border/50 rounded-lg p-4 mt-4">
          <p className="text-muted-foreground text-sm">
            <strong className="text-foreground">Notice:</strong> These Terms
            contain a binding arbitration clause and class action waiver
            (Section 10) that affect your legal rights. Please read them
            carefully.
          </p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">2. About Broski</h2>
        <p className="text-muted-foreground leading-relaxed">
          Broski is a mobile application that lets you remotely control AI
          coding agents (Claude Code, Pi) running on your computer
          from your phone. It connects to a bridge server you run on your own
          machine. Broski is free and open source; there is no paid
          subscription or cloud account.
        </p>
        <div className="bg-card/50 border border-border/50 rounded-lg p-4 mt-4">
          <p className="text-muted-foreground text-sm">
            <strong className="text-foreground">Important:</strong> Broski is a
            remote control interface. We do not provide AI services, host your
            code, or store your conversations.
          </p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">
          3. Eligibility &amp; Account
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          You must be at least 17 years old. No cloud account is required. You
          pair the App to your own computer by scanning the QR code shown by
          the local bridge. You are responsible for maintaining the security of
          your bridge server credentials.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">4. No Paid Subscription</h2>
        <p className="text-muted-foreground leading-relaxed">
          Broski is free and open source. There is no in-app purchase,
          subscription, trial, restore-purchases flow, or cloud entitlement
          check.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">
          5. Your Responsibilities
        </h2>
        <ul className="space-y-2 text-muted-foreground">
          <li className="flex items-start gap-3">
            <span className="text-accent mt-1">&#8226;</span>
            <span>
              Securing your bridge connection, credentials, and computer
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent mt-1">&#8226;</span>
            <span>
              Complying with terms of AI providers you use (Anthropic, OpenAI,
              etc.)
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent mt-1">&#8226;</span>
            <span>
              Reviewing all AI-generated code before use or deployment
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent mt-1">&#8226;</span>
            <span>
              All commands executed and code changes made through the App
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent mt-1">&#8226;</span>
            <span>Maintaining backups of your code and data</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent mt-1">&#8226;</span>
            <span>
              Not reverse engineering, circumventing licensing, or sharing your
              account
            </span>
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">
          6. Third-Party Services
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          Broski connects to AI services that run on your computer. Your use of
          these is subject to their terms:
        </p>
        <ul className="mt-4 space-y-2 text-muted-foreground">
          <li>
            <a
              href="https://www.anthropic.com/legal/consumer-terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Anthropic Terms of Service
            </a>
          </li>
          <li>
            <a
              href="https://openai.com/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              OpenAI Terms of Use
            </a>
          </li>
        </ul>
        <p className="text-muted-foreground mt-4 text-sm">
          We are not responsible for the availability or behavior of any
          third-party services.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">
          7. Intellectual Property
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          The App and its content are owned by us and protected by intellectual
          property laws. We grant you a limited, non-exclusive,
          non-transferable, revocable license to use the App subject to these
          Terms.
        </p>
        <p className="text-muted-foreground leading-relaxed mt-4">
          You retain full ownership of all content you create or transmit
          through the App (code, messages, files). We do not access, view, or
          store your content on our servers.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">
          8. Disclaimers &amp; Limitation of Liability
        </h2>
        <div className="bg-card/50 border border-border/50 rounded-lg p-6">
          <p className="text-muted-foreground leading-relaxed">
            The App is provided &quot;AS IS&quot; and &quot;AS AVAILABLE&quot;
            without warranties of any kind. We specifically disclaim liability
            for:
          </p>
          <ul className="mt-4 space-y-2 text-muted-foreground">
            <li className="flex items-start gap-3">
              <span className="text-destructive mt-1">&#8226;</span>
              <span>
                AI-generated code (bugs, security issues, data loss)
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-destructive mt-1">&#8226;</span>
              <span>
                Actions taken by AI agents on your computer
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-destructive mt-1">&#8226;</span>
              <span>Third-party service outages or changes</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-destructive mt-1">&#8226;</span>
              <span>
                Unauthorized access due to your network configuration
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-destructive mt-1">&#8226;</span>
              <span>Service interruptions or errors</span>
            </li>
          </ul>
          <p className="text-muted-foreground mt-4 text-sm">
            Our total liability is limited to the greater of (a) the amount you
            paid us in the 12 months before the claim, or (b) $100 USD. Some
            jurisdictions limit exclusions &mdash; in those cases, liability is
            limited to the maximum extent permitted by law.
          </p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">9. Indemnification</h2>
        <p className="text-muted-foreground leading-relaxed">
          You agree to indemnify and hold us harmless from any claims, damages,
          or expenses arising from your use of the App, violation of these
          Terms, deployment of AI-generated code, or breach of any third-party
          rights.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">
          10. Arbitration &amp; Dispute Resolution
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          Disputes will first be resolved informally by contacting
          broskiappp@gmail.com. If unresolved within 60 days, disputes are
          subject to binding individual arbitration (JAMS Streamlined Rules),
          not court.
        </p>
        <div className="bg-card/50 border border-border/50 rounded-lg p-4 mt-4">
          <p className="text-muted-foreground text-sm">
            <strong className="text-foreground">Class Action Waiver:</strong>{" "}
            You agree that disputes will be resolved individually, not in a
            class, consolidated, or representative action.
          </p>
          <p className="text-muted-foreground text-sm mt-2">
            <strong className="text-foreground">Opt-out:</strong> You may opt
            out of arbitration within 30 days of first using the App by emailing
            broskiappp@gmail.com.
          </p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">
          11. Termination
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          You may stop using the App at any time. We may suspend or terminate
          access for Terms violations, fraud, or if required by law.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">12. Governing Law</h2>
        <p className="text-muted-foreground leading-relaxed">
          These Terms are governed by the laws of the State of California, USA,
          without regard to conflict of law provisions. For matters not subject
          to arbitration, you consent to the exclusive jurisdiction of courts in
          San Francisco County, California.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">
          13. Apple &amp; Google Platform Terms
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          If you downloaded from the App Store: these Terms are between you and
          us, not Apple. Apple has no obligation for maintenance, support,
          warranties, or claims. Apple and its subsidiaries are third-party
          beneficiaries of these Terms.
        </p>
        <p className="text-muted-foreground leading-relaxed mt-4">
          Your use is also subject to{" "}
          <a
            href="https://www.apple.com/legal/internet-services/itunes/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Apple Media Services Terms
          </a>{" "}
          or{" "}
          <a
            href="https://play.google.com/about/play-terms/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Google Play Terms
          </a>
          .
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">
          14. Changes to Terms
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          We may modify these Terms at any time. Material changes will be
          communicated via the App with at least 30 days notice where
          practicable. Continued use after changes constitutes acceptance.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">15. Contact Us</h2>
        <p className="text-muted-foreground">
          Questions about these Terms:
        </p>
        <p className="mt-4">
          <a
            href="mailto:broskiappp@gmail.com"
            className="text-primary hover:underline"
          >
            broskiappp@gmail.com
          </a>
        </p>
        <p className="mt-2">
          <a
            href="https://broskiapp.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            broskiapp.com
          </a>
        </p>
      </section>
    </article>
  );
}
