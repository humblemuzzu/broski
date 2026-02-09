import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";
import { SimpleTable } from "@/components/docs/docs-table";
import { Callout } from "@/components/docs/callout";

export const metadata: Metadata = {
  title: "AI Backend Issues - Broski",
  description: "Troubleshoot issues specific to OpenCode, Claude Code, and Codex backends",
};

export default function AIBackendsTroubleshootingPage() {
  return (
    <article className="max-w-3xl">
      <h1 id="ai-backends" className="text-4xl font-bold mb-4">AI Backend Issues</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Troubleshoot issues specific to OpenCode, Claude Code, and Codex backends.
      </p>

      {/* OpenCode Issues */}
      <section className="mb-12">
        <h2 id="opencode-issues" className="text-2xl font-semibold mb-4">OpenCode Issues</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">&quot;OpenCode not found&quot; / &quot;OpenCode not starting&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              Bridge can&apos;t find or start OpenCode.
            </p>
            <CodeBlock language="bash">{`# Check if OpenCode is installed
which opencode && opencode --version

# If not found, install it
curl -fsSL https://opencode.ai/install | bash
# or: bun add -g opencode-ai

# Then reload your shell
source ~/.bashrc  # or ~/.zshrc`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">&quot;OpenCode started but did not become ready&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              OpenCode process started but the HTTP server didn&apos;t respond within 10 seconds.
            </p>
            <CodeBlock language="bash">{`# Try running OpenCode manually to see errors
opencode serve

# Check if port is in use
lsof -i :4096

# Try manual mode with explicit URL
broski --manual --opencode-url http://localhost:4096`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Provider Errors / &quot;Provider not configured&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              OpenCode needs an AI provider configured (Anthropic, OpenAI, etc).
            </p>
            <CodeBlock language="bash">{`# Check if API key is set
echo $ANTHROPIC_API_KEY
echo $OPENAI_API_KEY

# Set API key (add to ~/.bashrc or ~/.zshrc for persistence)
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...

# Check OpenCode config
cat ~/.config/opencode/opencode.jsonc`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">OpenCode Crashes / Health Check Failures</div>
            <p className="text-sm text-muted-foreground mb-3">
              Bridge shows &quot;OpenCode not running&quot;, sessions disappear.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside mb-3">
              <li>The bridge auto-restarts managed OpenCode if it crashes</li>
              <li>Check system resources (RAM, CPU)</li>
              <li>Look for error messages in bridge logs</li>
            </ul>
            <CodeBlock language="bash">{`# Run backend-focused diagnostics
broski doctor --profile agents

# Check OpenCode process
ps aux | grep opencode

# Test OpenCode health directly
curl http://localhost:4096/path

# Follow logs while reproducing issue
broski logs --follow`}</CodeBlock>
          </div>
        </div>

        <h3 id="opencode-common-mistakes" className="text-lg font-semibold mt-6 mb-3">Common Mistakes - OpenCode</h3>
        <SimpleTable
          headers={["Mistake", "Fix"]}
          rows={[
            ["API key not exported", "Add export to ~/.bashrc or ~/.zshrc"],
            ["Wrong model name", "Check OpenCode docs for exact model names"],
            ["Port conflict", "Use different port or kill existing process"],
            ["Config file syntax error", "Validate JSONC syntax"],
            ["Missing ~/.config/opencode/", "Run opencode once to create config"],
          ]}
        />
      </section>

      {/* Claude Code Issues */}
      <section className="mb-12">
        <h2 id="claude-code-issues" className="text-2xl font-semibold mb-4">Claude Code Issues</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">&quot;Claude Code auth not configured&quot; / &quot;cc_auth_missing&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              No valid Anthropic authentication found.
            </p>
            <CodeBlock language="bash">{`# Option 1: Set API Key
export ANTHROPIC_API_KEY=sk-ant-...
broski

# Option 2: Login via Claude CLI
claude login
# Follow the prompts

# Check existing auth
cat ~/.claude/settings.json`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Rate Limiting / &quot;Rate limit exceeded&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              Too many requests to the Anthropic API.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>Wait for rate limit to reset (usually 1 minute)</li>
              <li>Check your plan limits on the Anthropic dashboard</li>
              <li>Session shows &quot;retry&quot; status and auto-retries</li>
              <li>Reduce request frequency if persistent</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Context Length Exceeded</div>
            <p className="text-sm text-muted-foreground mb-3">
              Session refuses new messages, &quot;Context too long&quot; error.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>Use <code className="bg-muted/50 px-1 rounded">/compact</code> command to summarize and reduce context</li>
              <li>Start a new session (context is preserved in history)</li>
              <li>Fork the session to create a branch with less history</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Permission Issues / &quot;User denied permission&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              Tools won&apos;t execute, permission prompts timing out.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>Check for pending permission prompts in the app</li>
              <li>Permission prompt may be waiting on desktop - check there too</li>
              <li>Configure permission mode in settings (default, plan, auto-edit)</li>
              <li>Use &quot;Allow Always&quot; for trusted tools</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">&quot;Claude OAuth token expired&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              Your Claude login session has expired.
            </p>
            <CodeBlock language="bash">{`# Re-authenticate
claude login`}</CodeBlock>
          </div>
        </div>

        <h3 id="claude-code-common-mistakes" className="text-lg font-semibold mt-6 mb-3">Common Mistakes - Claude Code</h3>
        <SimpleTable
          headers={["Mistake", "Fix"]}
          rows={[
            ["Using wrong API key format", "Must start with sk-ant-"],
            ["API key not exported", "Add to shell config or pass via env"],
            ["Claude CLI not installed", "curl -fsSL https://claude.ai/install.sh | bash"],
            ["Expired OAuth token", "Run claude login again"],
            ["Denying all permissions", "Allow some tools or use auto-edit mode"],
          ]}
        />
      </section>

      {/* Codex Issues */}
      <section className="mb-12">
        <h2 id="codex-issues" className="text-2xl font-semibold mb-4">Codex Issues</h2>
        
        <Callout type="info" title="Codex is OpenAI's standalone agent">
          Codex is OpenAI&apos;s official CLI agent (like Claude Code is for Anthropic). It has its own tooling system and sandbox.
        </Callout>

        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">&quot;Authentication failed&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              Codex can&apos;t authenticate with OpenAI.
            </p>
            <CodeBlock language="bash">{`# Re-authenticate
codex --logout
codex

# Or set API key
export OPENAI_API_KEY=sk-...

# Verify the key works
curl -H "Authorization: Bearer $OPENAI_API_KEY" \\
  https://api.openai.com/v1/models`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">&quot;Codex OAuth token expired&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              Your Codex/OpenAI login session has expired.
            </p>
            <CodeBlock language="bash">{`# Re-authenticate
codex
# Follow the login prompts`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Rate Limiting / Quota Exceeded</div>
            <p className="text-sm text-muted-foreground mb-3">
              OpenAI rate limits or spending limits reached.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>Check your usage on the OpenAI dashboard</li>
              <li>Increase spending limits if needed</li>
              <li>Wait for rate limit window to reset</li>
              <li>Use a different model (e.g., gpt-4o-mini instead of gpt-4o)</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Model Not Available</div>
            <p className="text-sm text-muted-foreground mb-3">
              The requested model isn&apos;t available for your account.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>Some models require waitlist approval</li>
              <li>Check model availability on OpenAI dashboard</li>
              <li>Try a different model in OpenCode config</li>
            </ul>
          </div>
        </div>

        <h3 id="codex-common-mistakes" className="text-lg font-semibold mt-6 mb-3">Common Mistakes - Codex</h3>
        <SimpleTable
          headers={["Mistake", "Fix"]}
          rows={[
            ["Wrong API key format", "OpenAI keys start with sk-"],
            ["Using Claude key for OpenAI", "Keys are not interchangeable"],
            ["Model name typo", "Check exact model names on OpenAI docs"],
            ["Spending limit reached", "Increase limit on OpenAI dashboard"],
            ["Using deprecated model", "Update to current model names"],
          ]}
        />
      </section>

      {/* Environment Variables */}
      <section className="mb-12">
        <h2 id="env-vars" className="text-2xl font-semibold mb-4">Environment Variables Reference</h2>
        <SimpleTable
          headers={["Variable", "Backend", "Purpose"]}
          rows={[
            [<code key="1" className="text-xs">ANTHROPIC_API_KEY</code>, "Claude Code, OpenCode", "Anthropic API key"],
            [<code key="2" className="text-xs">OPENAI_API_KEY</code>, "OpenCode (Codex)", "OpenAI API key"],
            [<code key="3" className="text-xs">GOOGLE_AI_API_KEY</code>, "OpenCode", "Google Gemini API key"],
            [<code key="4" className="text-xs">OPENCODE_PORT</code>, "OpenCode", "Server port (default: 4096)"],
          ]}
        />

        <h3 id="setting-env-vars" className="text-lg font-semibold mt-6 mb-3">Setting Environment Variables Permanently</h3>
        <CodeBlock language="bash">{`# Add to ~/.bashrc or ~/.zshrc
echo 'export ANTHROPIC_API_KEY=sk-ant-...' >> ~/.zshrc
echo 'export OPENAI_API_KEY=sk-...' >> ~/.zshrc

# Reload shell config
source ~/.zshrc`}</CodeBlock>
      </section>

      {/* Switching Backends */}
      <section className="mb-12">
        <h2 id="switching" className="text-2xl font-semibold mb-4">Switching Between Backends</h2>
        <p className="text-muted-foreground mb-4">
          You can switch backends in the Broski app:
        </p>
        <ol className="text-muted-foreground space-y-2 list-decimal list-inside mb-4">
          <li>Go to Settings → AI Backend</li>
          <li>Select OpenCode, Claude Code, or Codex</li>
          <li>The bridge will reconnect with the selected backend</li>
        </ol>
        
        <Callout type="tip" title="Sessions are backend-specific">
          Sessions created with one backend cannot be opened with another. 
          Each backend maintains its own session history.
        </Callout>
      </section>

      {/* General Debugging */}
      <section className="mb-12">
        <h2 id="debugging" className="text-2xl font-semibold mb-4">General Debugging</h2>
        <CodeBlock language="bash">{`# Backend-focused diagnostics
broski doctor --profile agents

# Follow bridge logs
broski logs --follow

# Export diagnostics bundle for support/AI
broski logs --export

# Check backend directly
# For OpenCode:
curl http://localhost:4096/path

# For Claude Code (check if authenticated):
claude --version
cat ~/.claude/settings.json | head -5

# Check what processes are running
ps aux | grep -E "(opencode|claude|codex|broski)"`}</CodeBlock>
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
          <a href="/docs/backends/codex" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Codex</h3>
            <p className="text-sm text-muted-foreground">Full Codex documentation</p>
          </a>
          <a href="/docs/troubleshooting/errors" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Error Reference</h3>
            <p className="text-sm text-muted-foreground">Complete error message lookup</p>
          </a>
        </div>
      </section>
    </article>
  );
}
