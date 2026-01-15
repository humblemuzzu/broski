import type { Metadata } from "next";
import { CodeBlock, SimpleTable, Callout, CardGrid, Card } from "@/components/docs";

export const metadata: Metadata = {
  title: "Codex - Broski",
  description: "OpenAI's official CLI coding agent",
};

export default function CodexPage() {
  return (
    <article className="max-w-2xl">
      <h1 id="codex" className="text-3xl font-bold mb-3">Codex</h1>
      <p className="text-lg text-muted-foreground mb-8">
        OpenAI&apos;s official CLI coding agent with built-in sandboxing.
      </p>

      <h2 id="what-is-codex" className="text-xl font-semibold mb-4">What is Codex?</h2>
      
      <p className="text-sm text-muted-foreground mb-4">
        Codex is OpenAI&apos;s official agentic coding tool &mdash; similar to what Claude Code is for Anthropic. 
        It&apos;s a standalone CLI agent written in Rust with its own tooling system, sandbox modes, and 
        native integration with OpenAI&apos;s models.
      </p>

      <Callout type="info">
        Codex is a separate product from OpenCode. While OpenCode can use OpenAI models as one of many providers, 
        Codex is OpenAI&apos;s dedicated agent with its own tools and features.
      </Callout>

      <h2 id="features" className="text-xl font-semibold mb-4 mt-10">Key Features</h2>

      <div className="grid gap-3 mb-8">
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">Native Sandbox</div>
          <p className="text-xs text-muted-foreground">
            Built-in sandboxing for command execution using Seatbelt (macOS), Landlock (Linux), 
            or Windows Sandbox. Control what the agent can access.
          </p>
        </div>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">Own Tooling System</div>
          <p className="text-xs text-muted-foreground">
            Codex has its own tools: shell commands, file operations, directory listing, 
            grep search, and patch application &mdash; independent of any other agent.
          </p>
        </div>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">MCP Support</div>
          <p className="text-xs text-muted-foreground">
            Connect to MCP servers for additional tools, and even run Codex as an MCP server 
            to let other agents use it.
          </p>
        </div>
      </div>

      <h2 id="setup" className="text-xl font-semibold mb-4 mt-10">Setup</h2>
      
      <h3 id="step-1" className="text-base font-medium mb-3 mt-6">1. Install Codex</h3>
      <CodeBlock language="bash">{`npm install -g @openai/codex`}</CodeBlock>

      <h3 id="step-2" className="text-base font-medium mb-3 mt-6">2. Authenticate</h3>
      <p className="text-sm text-muted-foreground mb-3">
        Run Codex and sign in with your ChatGPT account, or set your API key:
      </p>
      <CodeBlock language="bash">{`# Option 1: Sign in with ChatGPT (recommended)
codex
# Follow the prompts to authenticate

# Option 2: Use API key
export OPENAI_API_KEY=sk-your-key-here`}</CodeBlock>

      <h3 id="step-3" className="text-base font-medium mb-3 mt-6">3. Start Broski</h3>
      <CodeBlock language="bash">{`bunx broski`}</CodeBlock>
      <p className="text-sm text-muted-foreground mt-3">
        Select Codex as your backend in the Broski app settings.
      </p>

      <h2 id="sandbox-modes" className="text-xl font-semibold mb-4 mt-10">Sandbox Modes</h2>
      
      <p className="text-sm text-muted-foreground mb-4">
        Codex provides built-in sandboxing to control what commands can do:
      </p>

      <SimpleTable
        headers={["Mode", "Description"]}
        rows={[
          ["read-only", "Commands can read but not modify files (default)"],
          ["workspace-write", "Allow writes within the current workspace"],
          ["danger-full-access", "Full system access (use with caution)"],
        ]}
      />

      <CodeBlock language="bash">{`# Start with workspace write access
codex --sandbox workspace-write`}</CodeBlock>

      <h2 id="tools" className="text-xl font-semibold mb-4 mt-10">Built-in Tools</h2>
      
      <p className="text-sm text-muted-foreground mb-4">
        Codex has its own native tools:
      </p>

      <SimpleTable
        headers={["Tool", "Description"]}
        rows={[
          ["shell", "Execute shell commands with sandbox protection"],
          ["read_file", "Read file contents with line numbers"],
          ["list_dir", "List directory contents"],
          ["grep_files", "Search file contents with regex"],
          ["apply_patch", "Apply code patches to files"],
          ["spawn_agent", "Create sub-agents for parallel work"],
        ]}
      />

      <h2 id="authentication" className="text-xl font-semibold mb-4 mt-10">Authentication Options</h2>

      <SimpleTable
        headers={["Method", "How"]}
        rows={[
          ["ChatGPT Login", "Sign in with your ChatGPT Plus/Pro/Team account"],
          ["API Key", "Set OPENAI_API_KEY or CODEX_API_KEY environment variable"],
        ]}
      />

      <Callout type="tip">
        Using ChatGPT login lets you use your existing subscription. API key gives more control 
        but charges separately.
      </Callout>

      <h2 id="troubleshooting" className="text-xl font-semibold mb-4 mt-10">Troubleshooting</h2>
      
      <h3 id="auth-issues" className="text-base font-medium mb-3 mt-6">Authentication Failed</h3>
      <CodeBlock language="bash">{`# Check if API key is set
echo $OPENAI_API_KEY

# Re-authenticate
codex --logout
codex`}</CodeBlock>

      <h3 id="sandbox-issues" className="text-base font-medium mb-3 mt-6">Sandbox Blocking Commands</h3>
      <p className="text-sm text-muted-foreground mb-3">
        If legitimate commands are being blocked, try a less restrictive sandbox mode:
      </p>
      <CodeBlock language="bash">{`codex --sandbox workspace-write`}</CodeBlock>

      <h2 id="next-steps" className="text-lg font-semibold mb-4 mt-10">Next</h2>
      <CardGrid>
        <Card href="/docs/backends/claude-code" title="Claude Code" description="Anthropic's official agent" />
        <Card href="/docs/backends/opencode" title="OpenCode" description="Multi-provider alternative" />
        <Card href="/docs/backends" title="Backend Overview" description="Compare all backends" />
      </CardGrid>
    </article>
  );
}
