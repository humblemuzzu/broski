import type { Metadata } from "next";
import { CodeBlock, SimpleTable, Callout, CardGrid, Card } from "@/components/docs";

export const metadata: Metadata = {
  title: "OpenCode - Broski",
  description: "Multi-provider AI coding agent",
};

export default function OpenCodePage() {
  return (
    <article className="max-w-2xl">
      <h1 id="opencode" className="text-3xl font-bold mb-3">OpenCode</h1>
      <p className="text-lg text-muted-foreground mb-8">
        Open-source multi-provider AI coding agent. The default backend for Broski.
      </p>

      <h2 id="features" className="text-xl font-semibold mb-4">Key Features</h2>

      <div className="grid gap-3 mb-8">
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">Multi-Provider Support</div>
          <p className="text-xs text-muted-foreground">
            Connect to 75+ AI providers including Anthropic, OpenAI, Google, Amazon Bedrock, Azure, and more.
            Use your existing subscriptions (Claude Pro, ChatGPT Plus) or API keys.
          </p>
        </div>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">Full MCP Support</div>
          <p className="text-xs text-muted-foreground">
            First-class Model Context Protocol integration. Add custom tools, resources, 
            and data sources through MCP servers.
          </p>
        </div>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">Session Management</div>
          <p className="text-xs text-muted-foreground">
            Create, fork, share, and summarize sessions. Generate public URLs to share 
            conversations with teammates.
          </p>
        </div>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">Open Source</div>
          <p className="text-xs text-muted-foreground">
            Fully open-source with transparent code. Customize, extend, and contribute 
            to the project.
          </p>
        </div>
      </div>

      <Callout type="info">
        OpenCode supports 75+ AI providers. See the{" "}
        <a href="https://opencode.ai/docs/providers" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
          OpenCode documentation
        </a>{" "}
        for the full list.
      </Callout>

      <h2 id="setup" className="text-xl font-semibold mb-4 mt-10">Setup</h2>
      
      <h3 id="installation" className="text-base font-medium mb-3 mt-6">Installation</h3>
      <CodeBlock language="bash">{`# Install script (recommended)
curl -fsSL https://opencode.ai/install | bash

# Or via npm/bun
npm install -g opencode-ai
bun install -g opencode-ai

# Verify installation
opencode --version`}</CodeBlock>

      <h3 id="configure-provider" className="text-base font-medium mb-3 mt-6">Configure a Provider</h3>
      
      <p className="text-sm text-muted-foreground mb-3">
        Set your API key and select a default model:
      </p>

      <CodeBlock language="bash">{`# Set API key (Anthropic example)
export ANTHROPIC_API_KEY=sk-ant-your-key-here

# Or OpenAI
export OPENAI_API_KEY=sk-your-key-here

# Set default model
opencode config set model "anthropic/claude-sonnet-4-20250514"`}</CodeBlock>

      <h2 id="config-files" className="text-xl font-semibold mb-4 mt-10">Configuration Files</h2>
      
      <p className="text-sm text-muted-foreground mb-4">
        OpenCode uses two configuration files &mdash; global (user-level) and project-level:
      </p>

      <h3 id="global-config" className="text-base font-medium mb-3 mt-6">Global Config</h3>
      <CodeBlock language="jsonc" filename="~/.config/opencode/opencode.jsonc">{`{
  "$schema": "https://opencode.ai/config.json",
  "theme": "dracula",
  "model": "anthropic/claude-sonnet-4-20250514",
  "small_model": "anthropic/claude-haiku-4-5-20250514",
  "autoupdate": true,
  
  // Tool permissions
  "permission": {
    "edit": "allow",
    "bash": { "*": "ask" },
    "webfetch": "allow"
  },
  
  // Enable/disable tools
  "tools": {
    "bash": true,
    "edit": true,
    "webfetch": true
  }
}`}</CodeBlock>

      <h3 id="project-config" className="text-base font-medium mb-3 mt-6">Project Config</h3>
      <CodeBlock language="jsonc" filename=".opencode/opencode.jsonc">{`{
  // Project-specific agent configuration
  "agent": {
    "build": {
      "model": "anthropic/claude-sonnet-4",
      "temperature": 0.3,
      "permission": {
        "bash": { 
          "npm *": "allow", 
          "git *": "allow",
          "rm -rf *": "deny"
        }
      }
    }
  },
  
  // Project MCP servers
  "mcp": {
    "database": {
      "type": "local",
      "command": ["node", "./scripts/mcp-db.js"]
    }
  }
}`}</CodeBlock>

      <Callout type="tip">
        Project config overrides global config. Use project config for repository-specific 
        settings like allowed commands or custom MCP servers.
      </Callout>

      <h2 id="tools" className="text-xl font-semibold mb-4 mt-10">Built-in Tools</h2>
      
      <SimpleTable
        headers={["Tool", "Description", "Permission"]}
        rows={[
          [<code key="1">read</code>, "Read file contents with optional line range", "Safe"],
          [<code key="2">write</code>, "Create or overwrite files (requires prior read)", <strong key="s2">Approval</strong>],
          [<code key="3">edit</code>, "Precise string replacement (oldString → newString)", <strong key="s3">Approval</strong>],
          [<code key="4">glob</code>, "Find files matching pattern (e.g., **/*.ts)", "Safe"],
          [<code key="5">grep</code>, "Regex search in file contents", "Safe"],
          [<code key="6">ls</code>, "List directory contents", "Safe"],
          [<code key="7">bash</code>, "Execute shell commands with timeout", <strong key="s7">Approval</strong>],
          [<code key="8">task</code>, "Launch subagents for parallel work", "Safe"],
          [<code key="9">todowrite</code>, "Create and manage task lists", "Safe"],
          [<code key="10">todoread</code>, "Read current tasks", "Safe"],
          [<code key="11">webfetch</code>, "Fetch web page contents", "Configurable"],
          [<code key="12">websearch</code>, "Search the web for documentation", "Configurable"],
          [<code key="13">codesearch</code>, "Search GitHub code examples", "Safe"],
          [<code key="14">skill</code>, "Load specialized knowledge", "Safe"],
        ]}
      />

      <h2 id="mcp-config" className="text-xl font-semibold mb-4 mt-10">MCP Server Configuration</h2>
      
      <p className="text-sm text-muted-foreground mb-4">
        Add MCP servers to extend OpenCode with custom tools and data sources:
      </p>

      <CodeBlock language="jsonc" filename=".opencode/opencode.jsonc">{`{
  "mcp": {
    // Local MCP server (subprocess)
    "filesystem": {
      "type": "local",
      "command": ["npx", "@modelcontextprotocol/server-filesystem"],
      "environment": {
        "ALLOWED_PATHS": "/Users/me/projects"
      },
      "enabled": true
    },
    
    // Remote MCP server (HTTP/SSE)
    "github": {
      "type": "remote",
      "url": "https://mcp.github.com/sse",
      "headers": {
        "Authorization": "Bearer \${GITHUB_TOKEN}"
      }
    }
  }
}`}</CodeBlock>

      <h2 id="sessions" className="text-xl font-semibold mb-4 mt-10">Session Management</h2>
      
      <SimpleTable
        headers={["Feature", "Description"]}
        rows={[
          ["Create", "Start new coding sessions in any project"],
          ["Fork", "Branch from any message point"],
          ["Share", "Generate public URLs to share sessions"],
          ["Summarize", "Compact long conversations to save context"],
          ["Revert", "Undo file changes to any message point"],
        ]}
      />

      <h2 id="troubleshooting" className="text-xl font-semibold mb-4 mt-10">Troubleshooting</h2>
      
      <h3 id="not-starting" className="text-base font-medium mb-3 mt-6">OpenCode Not Starting</h3>
      <Callout type="warning" title="Command not found">
        OpenCode is not installed or not in your PATH.
      </Callout>
      <CodeBlock language="bash">{`# Check if installed
opencode --version

# If not found, reinstall:
npm install -g opencode

# Or check your PATH:
echo $PATH`}</CodeBlock>

      <h3 id="port-conflict" className="text-base font-medium mb-3 mt-6">Port Conflict</h3>
      <Callout type="warning" title="Port 4096 in use">
        Another process is using OpenCode&apos;s default port.
      </Callout>
      <CodeBlock language="bash">{`# Check what's using the port
lsof -i :4096

# Use a different port
OPENCODE_PORT=4097 opencode`}</CodeBlock>

      <h3 id="provider-errors" className="text-base font-medium mb-3 mt-6">Provider Errors</h3>
      <Callout type="warning" title="Provider not configured">
        API key missing or invalid.
      </Callout>
      <CodeBlock language="bash">{`# Verify API key is set
echo $ANTHROPIC_API_KEY

# Check OpenCode config
opencode config get

# Test API key directly
curl -H "x-api-key: $ANTHROPIC_API_KEY" \\
     -H "anthropic-version: 2023-06-01" \\
     https://api.anthropic.com/v1/messages \\
     -d '{"model":"claude-3-sonnet-20240229","max_tokens":10,"messages":[{"role":"user","content":"Hi"}]}'`}</CodeBlock>

      <h3 id="health-check" className="text-base font-medium mb-3 mt-6">Health Check Failures</h3>
      <Callout type="warning" title="OpenCode health check failed">
        The bridge cannot connect to OpenCode.
      </Callout>
      <CodeBlock language="bash">{`# Kill any stuck processes
pkill opencode

# Restart the bridge
bunx broski

# Or check if OpenCode is running
ps aux | grep opencode`}</CodeBlock>

      <h2 id="next-steps" className="text-lg font-semibold mb-4 mt-10">Next</h2>
      <CardGrid>
        <Card href="/docs/backends/claude-code" title="Claude Code" description="Anthropic's official agent" />
        <Card href="/docs/backends/codex" title="Codex" description="OpenAI's official agent" />
        <Card href="/docs/backends" title="Backend Overview" description="Compare all backends" />
      </CardGrid>
    </article>
  );
}
