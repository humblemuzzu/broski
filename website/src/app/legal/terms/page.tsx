import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service - Broski",
  description: "Broski Terms of Service - Usage terms and conditions",
};

export default function TermsOfServicePage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
      <p className="text-muted-foreground mb-8">Last updated: January 14, 2026</p>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">1. About Broski</h2>
        <p className="text-muted-foreground leading-relaxed">
          Broski is a mobile companion app for AI coding assistants. It allows you to interact with 
          AI coding agents (Claude Code, OpenCode, Codex) running on your computer from your mobile device.
        </p>
        <div className="bg-card/50 border border-border/50 rounded-lg p-4 mt-4">
          <p className="text-muted-foreground text-sm">
            <strong className="text-foreground">Important:</strong> Broski requires a bridge server running on your 
            Mac to function. The app connects to your computer, not to our servers.
          </p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">2. Acceptance of Terms</h2>
        <p className="text-muted-foreground leading-relaxed">
          By downloading, installing, or using Broski, you agree to be bound by these Terms of Service. 
          If you do not agree to these terms, please do not use the app.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">3. Use of Service</h2>
        <p className="text-muted-foreground mb-4">You agree to use Broski only for:</p>
        <ul className="space-y-2 text-muted-foreground">
          <li className="flex items-start gap-3">
            <span className="text-primary mt-1">&#8226;</span>
            <span>Legitimate software development purposes</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-primary mt-1">&#8226;</span>
            <span>Interacting with AI coding assistants you have authorized access to</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-primary mt-1">&#8226;</span>
            <span>Connecting to computers and networks you own or have permission to access</span>
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">4. Your Responsibilities</h2>
        <p className="text-muted-foreground mb-4">You are responsible for:</p>
        <ul className="space-y-2 text-muted-foreground">
          <li className="flex items-start gap-3">
            <span className="text-accent mt-1">&#8226;</span>
            <span>Securing your bridge connection and credentials</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent mt-1">&#8226;</span>
            <span>Complying with the terms of service of any AI services you connect to (Anthropic, OpenAI, etc.)</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent mt-1">&#8226;</span>
            <span>All code changes and commands executed through the app</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent mt-1">&#8226;</span>
            <span>Reviewing AI-generated code before deployment</span>
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">5. Third-Party Services</h2>
        <p className="text-muted-foreground leading-relaxed">
          Broski connects to third-party AI services including Claude Code (Anthropic), OpenCode, 
          and Codex (OpenAI). Your use of these services is subject to their respective terms:
        </p>
        <ul className="mt-4 space-y-2 text-muted-foreground">
          <li>
            <a href="https://www.anthropic.com/legal/consumer-terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Anthropic Terms of Service
            </a>
          </li>
          <li>
            <a href="https://openai.com/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              OpenAI Terms of Use
            </a>
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">6. Intellectual Property</h2>
        <p className="text-muted-foreground leading-relaxed">
          Broski and its original content, features, and functionality are owned by us and are protected 
          by international copyright, trademark, and other intellectual property laws.
        </p>
        <p className="text-muted-foreground leading-relaxed mt-4">
          Code generated by AI services through Broski belongs to you, subject to any applicable 
          terms from the AI service providers.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">7. Disclaimer of Warranties</h2>
        <div className="bg-card/50 border border-border/50 rounded-lg p-6">
          <p className="text-muted-foreground leading-relaxed">
            Broski is provided &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; without warranties of any kind, 
            either express or implied, including but not limited to:
          </p>
          <ul className="mt-4 space-y-2 text-muted-foreground">
            <li className="flex items-start gap-3">
              <span className="text-destructive mt-1">&#8226;</span>
              <span>Accuracy or quality of AI-generated code</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-destructive mt-1">&#8226;</span>
              <span>Uninterrupted or error-free service</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-destructive mt-1">&#8226;</span>
              <span>Fitness for a particular purpose</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-destructive mt-1">&#8226;</span>
              <span>Security of your connection or data</span>
            </li>
          </ul>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">8. Limitation of Liability</h2>
        <p className="text-muted-foreground leading-relaxed">
          To the maximum extent permitted by law, we shall not be liable for any indirect, incidental, 
          special, consequential, or punitive damages, including but not limited to:
        </p>
        <ul className="mt-4 space-y-2 text-muted-foreground">
          <li className="flex items-start gap-3">
            <span className="text-muted-foreground mt-1">&#8226;</span>
            <span>Loss of data or code</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-muted-foreground mt-1">&#8226;</span>
            <span>Damages from AI-generated code</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-muted-foreground mt-1">&#8226;</span>
            <span>Security breaches on your network</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-muted-foreground mt-1">&#8226;</span>
            <span>Service interruptions</span>
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">9. Indemnification</h2>
        <p className="text-muted-foreground leading-relaxed">
          You agree to indemnify and hold us harmless from any claims, damages, or expenses arising 
          from your use of Broski, including any code you deploy that was generated or modified 
          using AI services through the app.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">10. Termination</h2>
        <p className="text-muted-foreground leading-relaxed">
          We may terminate or suspend your access to Broski immediately, without prior notice, for any 
          reason, including breach of these Terms. Upon termination, your right to use the app will 
          immediately cease.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">11. Changes to Terms</h2>
        <p className="text-muted-foreground leading-relaxed">
          We reserve the right to modify these terms at any time. We will provide notice of significant 
          changes by updating the &quot;Last updated&quot; date. Your continued use of Broski after changes 
          constitutes acceptance of the new terms.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">12. Governing Law</h2>
        <p className="text-muted-foreground leading-relaxed">
          These Terms shall be governed by and construed in accordance with applicable laws, without 
          regard to conflict of law principles.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">13. Contact Us</h2>
        <p className="text-muted-foreground">
          If you have any questions about these Terms of Service, please contact us:
        </p>
        <p className="mt-4">
          <a href="mailto:broskiappp@gmail.com" className="text-primary hover:underline">
            broskiappp@gmail.com
          </a>
        </p>
      </section>
    </article>
  );
}
