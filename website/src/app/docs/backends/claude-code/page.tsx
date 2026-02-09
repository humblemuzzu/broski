import type { Metadata } from "next";
import { CodeBlock, SimpleTable, Callout, CardGrid, Card } from "@/components/docs";

export const metadata: Metadata = {
  title: "Claude Code - Broski",
  description: "Anthropic's official AI coding agent",
};

export default function ClaudeCodePage() {
  return (
    <article className="max-w-2xl">
      <h1 id="claude-code" className="text-3xl font-bold mb-3">Claude Code</h1>
      <p className="text-lg text-muted-foreground mb-8">
        Anthropic&apos;s official AI coding agent with extended thinking, plugins, and subagents.
      </p>

      <h2 id="features" className="text-xl font-semibold mb-4">Key Features</h2>
      
      <div className="grid gap-3 mb-8">
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">Extended Thinking</div>
          <p className="text-xs text-muted-foreground">
            See Claude&apos;s reasoning process in real-time. Watch as it analyzes code, 
            considers options, and explains its approach before taking action.
          </p>
        </div>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">Plugins & Skills</div>
          <p className="text-xs text-muted-foreground">
            Extend capabilities with plugins. Load specialized skills for frameworks, 
            languages, or custom workflows.
          </p>
        </div>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">Subagents</div>
          <p className="text-xs text-muted-foreground">
            Spawn specialized agents for focused tasks. Create a code reviewer, 
            documentation writer, or test generator that runs in parallel.
          </p>
        </div>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">File Checkpointing</div>
          <p className="text-xs text-muted-foreground">
            Every user message creates a checkpoint. Undo file changes to any point 
            in the conversation with a single action.
          </p>
        </div>
      </div>

      <h2 id="setup" className="text-xl font-semibold mb-4">Setup</h2>
      
      <h3 id="installation" className="text-base font-medium mb-3 mt-6">Installation</h3>
      <CodeBlock language="bash">{`# Install Claude Code CLI
curl -fsSL https://claude.ai/install.sh | bash

# Verify installation
claude --version`}</CodeBlock>

      <h3 id="authentication" className="text-base font-medium mb-3 mt-6">Authentication</h3>
      
      <p className="text-sm text-muted-foreground mb-3">Choose one authentication method:</p>
      
      <Callout type="note" title="Option A: API Key (Recommended)">
        Set your Anthropic API key as an environment variable. Best for automated setups.
      </Callout>
      <CodeBlock language="bash">{`# Add to your shell profile (~/.zshrc or ~/.bashrc)
export ANTHROPIC_API_KEY=sk-ant-your-key-here

# Then start the bridge
broski`}</CodeBlock>

      <Callout type="note" title="Option B: OAuth Login">
        Use browser-based authentication. Convenient for personal use.
      </Callout>
      <CodeBlock language="bash">{`# Authenticate via browser
claude login

# Then start the bridge
broski`}</CodeBlock>

      <h2 id="permission-modes" className="text-xl font-semibold mb-4 mt-10">Permission Modes</h2>
      
      <p className="text-sm text-muted-foreground mb-4">
        Claude Code has different permission modes that control how it handles file edits and shell commands:
      </p>
      
      <SimpleTable
        headers={["Mode", "File Edits", "Shell Commands", "Use Case"]}
        rows={[
          [<code key="1">default</code>, "Ask", "Ask", "Safe exploration, review each change"],
          [<code key="2">acceptEdits</code>, "Auto-approve", "Ask", "Trust file changes, review commands"],
          [<code key="3">plan</code>, "Blocked", "Blocked", "Read-only analysis, no modifications"],
          [<code key="4">bypassPermissions</code>, "Auto-approve", "Auto-approve", "Full trust, automated workflows"],
        ]}
      />

      <Callout type="warning">
        Use <code>bypassPermissions</code> only in trusted environments. 
        The agent can execute any command without confirmation.
      </Callout>

      <h2 id="tools" className="text-xl font-semibold mb-4 mt-10">Built-in Tools</h2>
      
      <SimpleTable
        headers={["Tool", "Description", "Permission Required"]}
        rows={[
          [<code key="1">Read</code>, "Read file contents with optional line range", "Safe"],
          [<code key="2">Write</code>, "Create new files (requires prior read)", <strong key="s2">Approval</strong>],
          [<code key="3">Edit</code>, "String replacement in existing files", <strong key="s3">Approval</strong>],
          [<code key="4">Bash</code>, "Execute shell commands with timeout", <strong key="s4">Approval</strong>],
          [<code key="5">Glob</code>, "Find files matching pattern (e.g., **/*.ts)", "Safe"],
          [<code key="6">Grep</code>, "Regex search in file contents", "Safe"],
          [<code key="7">WebFetch</code>, "Fetch web page contents", "Safe"],
          [<code key="8">WebSearch</code>, "Search the web for documentation", "Safe"],
          [<code key="9">Task</code>, "Spawn subagents for parallel work", "Safe"],
          [<code key="10">TodoRead</code>, "Read current task list", "Safe"],
          [<code key="11">TodoWrite</code>, "Update task list", "Safe"],
        ]}
      />

      <h2 id="subagents" className="text-xl font-semibold mb-4 mt-10">Subagents</h2>
      
      <p className="text-sm text-muted-foreground mb-4">
        Define specialized agents for focused tasks in your project&apos;s <code>.claude/</code> directory:
      </p>

      <CodeBlock language="json" filename=".claude/settings.json">{`{
  "agents": {
    "code-reviewer": {
      "description": "Expert code review focusing on security and best practices",
      "prompt": "Review code for security vulnerabilities, performance issues, and best practices",
      "tools": ["Read", "Grep", "Glob"],
      "model": "sonnet"
    },
    "test-writer": {
      "description": "Generate comprehensive test cases",
      "prompt": "Write thorough unit and integration tests",
      "tools": ["Read", "Write", "Glob"],
      "model": "sonnet"
    }
  }
}`}</CodeBlock>

      <h2 id="mcp-config" className="text-xl font-semibold mb-4 mt-10">MCP Configuration</h2>
      
      <p className="text-sm text-muted-foreground mb-4">
        Add MCP servers to extend Claude Code&apos;s capabilities:
      </p>

      <CodeBlock language="json" filename="~/.claude.json">{`{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem"],
      "env": {
        "ALLOWED_PATHS": "/Users/me/projects"
      }
    },
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}`}</CodeBlock>

      <Callout type="info">
        MCP tools appear with a prefix like <code>mcp__filesystem__list_files</code>. 
        You can allow or block specific MCP tools in your settings.
      </Callout>

      <h2 id="sessions" className="text-xl font-semibold mb-4 mt-10">Session Storage</h2>
      
      <p className="text-sm text-muted-foreground mb-4">
        Claude Code stores sessions as JSONL files on your computer:
      </p>

      <CodeBlock language="text" showHeader={false}>{`~/.claude/projects/[project-path-encoded]/[session-id].jsonl`}</CodeBlock>

      <SimpleTable
        headers={["Feature", "Description"]}
        rows={[
          ["Resume", "Continue any previous conversation"],
          ["Fork", "Branch from any message (creates new file)"],
          ["Delete", "Remove session files to free space"],
          ["Transcript", "Full history with tool calls and results"],
        ]}
      />

      <h2 id="troubleshooting" className="text-xl font-semibold mb-4 mt-10">Troubleshooting</h2>
      
      <h3 id="auth-failures" className="text-base font-medium mb-3 mt-6">Authentication Failures</h3>
      <Callout type="warning" title="Auth not configured">
        No valid authentication found. Ensure <code>ANTHROPIC_API_KEY</code> is set or run <code>claude login</code>.
      </Callout>
      <CodeBlock language="bash">{`# Check if API key is set
echo $ANTHROPIC_API_KEY

# If empty, add to your shell profile:
echo 'export ANTHROPIC_API_KEY=sk-ant-your-key' >> ~/.zshrc
source ~/.zshrc

# Or re-authenticate:
claude logout
claude login`}</CodeBlock>

      <h3 id="rate-limiting" className="text-base font-medium mb-3 mt-6">Rate Limiting</h3>
      <Callout type="warning" title="Rate limit exceeded">
        Too many requests. The bridge will automatically retry with backoff.
      </Callout>
      <p className="text-sm text-muted-foreground mb-4">
        Check your usage at the <a href="https://console.anthropic.com" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">Anthropic Console</a>. 
        Higher tier plans have increased rate limits.
      </p>

      <h3 id="context-length" className="text-base font-medium mb-3 mt-6">Context Length</h3>
      <Callout type="warning" title="Context too long">
        Conversation exceeds model context window.
      </Callout>
      <p className="text-sm text-muted-foreground mb-4">
        Start a new session or use the summarize feature to compact the conversation. 
        Long sessions with many file operations can hit context limits.
      </p>

      <h3 id="tool-permissions" className="text-base font-medium mb-3 mt-6">Tool Permission Denied</h3>
      <Callout type="warning" title="Tool not allowed">
        The requested tool is disabled in your configuration.
      </Callout>
      <CodeBlock language="json" filename="~/.claude/settings.json">{`{
  "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
  "disallowedTools": []
}`}</CodeBlock>

      <h2 id="next-steps" className="text-lg font-semibold mb-4 mt-10">Next</h2>
      <CardGrid>
        <Card href="/docs/backends/opencode" title="OpenCode" description="Multi-provider alternative" />
        <Card href="/docs/backends" title="Backend Overview" description="Compare all backends" />
        <Card href="/docs/troubleshooting/ai-backends" title="Troubleshooting" description="More backend issues" />
      </CardGrid>
    </article>
  );
}
