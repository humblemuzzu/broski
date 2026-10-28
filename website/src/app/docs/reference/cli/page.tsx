import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";

export const metadata: Metadata = {
  title: "CLI Reference - Broski",
  description: "Complete reference for Broski binary commands",
};

export default function CLIReferencePage() {
  return (
    <article className="max-w-3xl">
      <h1 id="cli-reference" className="text-4xl font-bold mb-4">CLI Reference</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Core commands for the Broski binary.
      </p>

      <section className="mb-12">
        <h2 id="usage" className="text-2xl font-semibold mb-4">Basic Usage</h2>
        <CodeBlock language="bash">{`broski [command] [options]`}</CodeBlock>
      </section>

      <section className="mb-12">
        <h2 id="core-commands" className="text-2xl font-semibold mb-4">Core Commands</h2>
        <CodeBlock language="bash">{`# Start bridge (default)
broski

# Setup / config
broski setup
broski configure

# Diagnostics
broski doctor
broski doctor --fix
broski doctor --profile pairing
broski doctor --export

# Guided troubleshooting
broski troubleshoot

# Logs
broski logs
broski logs --follow
broski logs --export

# Pairing and devices (Broski Link)
broski-link pair
broski-link status
broski-link devices
broski-link revoke <device id prefix>

# Background service
broski install
broski status
broski stop
broski restart
broski uninstall`}</CodeBlock>
      </section>

      <section className="mb-12">
        <h2 id="doctor-options" className="text-2xl font-semibold mb-4">Doctor Options</h2>
        <CodeBlock language="bash">{`# Full diagnostic run
broski doctor

# Apply safe automatic fixes
broski doctor --fix

# Focused profiles
broski doctor --profile network
broski doctor --profile pairing
broski doctor --profile agents
broski doctor --profile daemon
broski doctor --profile security

# Deep checks + machine-readable output
broski doctor --deep
broski doctor --json

# Export redacted diagnostics bundle
broski doctor --export`}</CodeBlock>
      </section>

      <section className="mb-12">
        <h2 id="logs-options" className="text-2xl font-semibold mb-4">Logs Options</h2>
        <CodeBlock language="bash">{`# Show recent logs
broski logs

# Stream logs live
broski logs --follow

# JSON output (for tooling)
broski logs --json --follow

# Include only latest N lines
broski logs --lines 300

# Export redacted diagnostics bundle
broski logs --export

# Power-user controls
broski logs --no-errors
broski logs --redact
broski logs --no-redact`}</CodeBlock>
      </section>

      <section className="mb-12">
        <h2 id="serve-options" className="text-2xl font-semibold mb-4">Serve Options</h2>
        <CodeBlock language="bash">{`# Custom bridge loopback port
broski --port 8080

# New local hook token
broski --new-token

# OpenCode manual mode
broski --manual --opencode-url http://localhost:4096`}</CodeBlock>
      </section>

      <section className="mt-12 pt-8 border-t border-border">
        <h2 id="related" className="text-lg font-semibold mb-4">Related</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/troubleshooting" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Troubleshooting</h3>
            <p className="text-sm text-muted-foreground">Fix connection, pairing, backend, and daemon issues</p>
          </a>
          <a href="/docs/bridge/configuration" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Bridge Configuration</h3>
            <p className="text-sm text-muted-foreground">Service, network, and runtime behavior</p>
          </a>
        </div>
      </section>
    </article>
  );
}
