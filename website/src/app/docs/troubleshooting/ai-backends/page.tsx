import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";

export const metadata: Metadata = {
  title: "AI Backend Issues - Broski",
  description: "Troubleshoot issues specific to OpenCode and Claude Code backends",
};

export default function AIBackendsTroubleshootingPage() {
  return (
    <article className="max-w-3xl">
      <h1 id="ai-backends" className="text-4xl font-bold mb-4">AI Backend Issues</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Troubleshoot issues specific to OpenCode and Claude Code backends.
      </p>

      {/* OpenCode Issues */}
      <section className="mb-12">
        <h2 id="opencode-issues" className="text-2xl font-semibold mb-4">OpenCode Issues</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">OpenCode Not Starting</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Bridge can&apos;t connect, &quot;OpenCode not running&quot; error.
            </p>
            <CodeBlock language="bash">{`# Check installation
opencode --version

# If not found, reinstall
npm install -g opencode

# Check if already running
ps aux | grep opencode`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Provider Errors</h3>
            <p className="text-sm text-muted-foreground mb-3">
              &quot;Provider not configured&quot;, &quot;Invalid API key&quot;
            </p>
            <CodeBlock language="bash">{`# Verify API key is set
echo $ANTHROPIC_API_KEY

# Check provider config
cat ~/.config/opencode/opencode.jsonc | grep -A5 "provider"`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Port Conflict</h3>
            <p className="text-sm text-muted-foreground mb-3">
              OpenCode can&apos;t start because port is in use.
            </p>
            <CodeBlock language="bash">{`# Check port 4096 (default)
lsof -i :4096

# Use different port
OPENCODE_PORT=4097 opencode`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* Claude Code Issues */}
      <section className="mb-12">
        <h2 id="claude-code-issues" className="text-2xl font-semibold mb-4">Claude Code Issues</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Authentication Failures</h3>
            <p className="text-sm text-muted-foreground mb-3">
              &quot;API key not found&quot;, &quot;Authentication failed&quot;
            </p>
            <CodeBlock language="bash">{`# Check API key
echo $ANTHROPIC_API_KEY
# Ensure it starts with sk-ant-

# Re-authenticate
claude logout
claude login`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Rate Limiting</h3>
            <p className="text-sm text-muted-foreground mb-3">
              &quot;Rate limit exceeded&quot;, slow responses.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>Check your Anthropic dashboard for usage</li>
              <li>Wait for rate limit to reset (usually 1 minute)</li>
              <li>Session shows &quot;retry&quot; status automatically</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Permission Issues</h3>
            <p className="text-sm text-muted-foreground mb-3">
              &quot;Permission denied&quot;, tools won&apos;t execute.
            </p>
            <p className="text-sm text-muted-foreground">
              Check your permission mode in settings. Try &quot;acceptEdits&quot; instead of &quot;default&quot;.
            </p>
          </div>
        </div>
      </section>

      {/* Common Mistakes */}
      <section className="mb-12">
        <h2 id="common-mistakes" className="text-2xl font-semibold mb-4">Common Mistakes</h2>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-border rounded-lg">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left p-3 border-b border-border">Mistake</th>
                <th className="text-left p-3 border-b border-border">Fix</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-3 border-b border-border/50">API key not exported</td>
                <td className="p-3 border-b border-border/50">Add to ~/.bashrc or ~/.zshrc</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50">Wrong model name</td>
                <td className="p-3 border-b border-border/50">Check provider docs for exact names</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50">Typo in config</td>
                <td className="p-3 border-b border-border/50">Validate JSON/JSONC syntax</td>
              </tr>
              <tr>
                <td className="p-3">Missing directory</td>
                <td className="p-3">Ensure project path exists</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Environment Variables */}
      <section className="mb-12">
        <h2 id="env-vars" className="text-2xl font-semibold mb-4">Environment Variables</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-border rounded-lg">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left p-3 border-b border-border">Variable</th>
                <th className="text-left p-3 border-b border-border">Backend</th>
                <th className="text-left p-3 border-b border-border">Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono text-xs">ANTHROPIC_API_KEY</td>
                <td className="p-3 border-b border-border/50">Both</td>
                <td className="p-3 border-b border-border/50">Anthropic API key</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono text-xs">OPENAI_API_KEY</td>
                <td className="p-3 border-b border-border/50">OpenCode</td>
                <td className="p-3 border-b border-border/50">OpenAI API key</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono text-xs">OPENCODE_PORT</td>
                <td className="p-3 border-b border-border/50">OpenCode</td>
                <td className="p-3 border-b border-border/50">Server port (default: 4096)</td>
              </tr>
              <tr>
                <td className="p-3 font-mono text-xs">BROSKI_AGENT</td>
                <td className="p-3">Bridge</td>
                <td className="p-3">Select backend</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Next Steps */}
      <section className="mt-12 pt-8 border-t border-border">
        <h2 id="next-steps" className="text-lg font-semibold mb-4">Related</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/backends/opencode" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">OpenCode</h3>
            <p className="text-sm text-muted-foreground">Full OpenCode documentation</p>
          </a>
          <a href="/docs/backends/claude-code" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Claude Code</h3>
            <p className="text-sm text-muted-foreground">Full Claude Code documentation</p>
          </a>
        </div>
      </section>
    </article>
  );
}
