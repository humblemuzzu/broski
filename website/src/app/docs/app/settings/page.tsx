import type { Metadata } from "next";
import { SimpleTable, Callout, CardGrid, Card } from "@/components/docs";

export const metadata: Metadata = {
  title: "Settings - Broski",
  description: "App configuration and preferences in the Broski mobile app",
};

export default function SettingsPage() {
  return (
    <article className="max-w-2xl">
      <h1 id="settings" className="text-3xl font-bold mb-3">Settings</h1>
      <p className="text-lg text-muted-foreground mb-8">
        Configure Broski to work the way you want.
      </p>

      <h2 id="connection" className="text-xl font-semibold mb-4 mt-10">Connection Section</h2>
      <p className="text-muted-foreground mb-4">
        When connected, shows your current bridge status:
      </p>

      <h3 id="active-connection" className="text-lg font-medium mb-3 mt-6">Active Connection Card</h3>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Device icon</strong> - Laptop/Mac icon</li>
        <li><strong>"OpenCode Bridge"</strong> - Connection name</li>
        <li><strong>Quality indicator</strong> - Signal strength bars</li>
        <li><strong>Expand arrow</strong> - Tap to show details</li>
      </ul>

      <h3 id="expanded-details" className="text-lg font-medium mb-3 mt-6">Expanded Details</h3>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Local IP</strong> - WiFi address</li>
        <li><strong>Port</strong> - Connection port</li>
        <li><strong>Tailscale IP</strong> - VPN address (if available)</li>
        <li><strong>Latency</strong> - Round-trip time in ms</li>
      </ul>

      <h3 id="device-manager" className="text-lg font-medium mb-3 mt-6">Device Manager</h3>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Paired Systems</strong> - List of known devices</li>
        <li><strong>Connection History</strong> - Previous connections</li>
      </ul>

      <h3 id="disconnect" className="text-lg font-medium mb-3 mt-6">Disconnect</h3>
      <p className="text-muted-foreground mb-4">
        Tap "Disconnect" to end the current session and return to the scan screen.
      </p>

      <h2 id="appearance" className="text-xl font-semibold mb-4 mt-10">Appearance Section</h2>

      <h3 id="customization" className="text-lg font-medium mb-3 mt-6">Customization</h3>
      <p className="text-muted-foreground mb-4">
        Opens the full customization screen with:
      </p>

      <SimpleTable
        headers={["Setting", "Options"]}
        rows={[
          ["Theme Selection", "System, Light, Dark, OpenCode, plus 27 themes"],
          ["Theme Colors", "View/modify palette"],
          ["Input Bar Style", "Standard, Rounded, Outlined"],
          ["Navigation Style", "Classic or Glassmorphic"],
          ["Prompt Accent", "Input border color"],
          ["Highlight Color", "Star/favorite color"],
        ]}
      />

      <h3 id="themes" className="text-lg font-medium mb-3 mt-6">Available Themes (27)</h3>
      <p className="text-muted-foreground mb-4">
        Broski includes 27 built-in themes:
      </p>
      <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground mb-6">
        <div>OpenCode (default)</div>
        <div>OpenCode Light</div>
        <div>Tokyo Night</div>
        <div>Dracula</div>
        <div>Catppuccin Mocha</div>
        <div>Catppuccin Frappe</div>
        <div>Catppuccin Macchiato</div>
        <div>Nord</div>
        <div>Gruvbox</div>
        <div>Aura</div>
        <div>Monokai</div>
        <div>Flexoki</div>
        <div>One Dark</div>
        <div>Solarized Dark</div>
        <div>GitHub Dark</div>
        <div>Matrix</div>
        <div>Synthwave 84</div>
        <div>Vesper</div>
        <div>Rose Pine</div>
        <div>Vercel</div>
        <div>Cobalt2</div>
        <div>Night Owl</div>
        <div>Palenight</div>
        <div>Material</div>
        <div>Everforest</div>
        <div>Kanagawa</div>
        <div>Zenburn</div>
      </div>

      <h3 id="icon-packs" className="text-lg font-medium mb-3 mt-6">Icon Packs</h3>
      <p className="text-muted-foreground mb-4">
        Choose how tool icons appear:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Material Outlined</strong> - Clean, default style</li>
        <li><strong>Material Filled</strong> - Solid icons</li>
        <li><strong>Minimal</strong> - Simple, lightweight</li>
        <li><strong>Rounded</strong> - Soft corners</li>
      </ul>

      <h2 id="ai" className="text-xl font-semibold mb-4 mt-10">AI Section</h2>

      <h3 id="ai-backend" className="text-lg font-medium mb-3 mt-6">AI Backend</h3>
      <p className="text-muted-foreground mb-4">
        Switch between supported backends:
      </p>

      <SimpleTable
        headers={["Backend", "Badge", "Description"]}
        rows={[
          ["OpenCode", "OC", "Multi-provider AI coding assistant"],
          ["Claude Code", "CC", "Anthropic's Claude with tools"],
          ["Codex", "CX", "OpenAI's official CLI agent"],
        ]}
      />

      <h3 id="providers" className="text-lg font-medium mb-3 mt-6">Providers</h3>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Model providers</strong> - OpenAI, Anthropic, etc.</li>
        <li><strong>API keys</strong> - Configure credentials</li>
        <li><strong>Model selection</strong> - Choose default model</li>
      </ul>

      <h2 id="opencode" className="text-xl font-semibold mb-4 mt-10">OpenCode Section</h2>
      <p className="text-muted-foreground mb-4">
        Only visible when OpenCode is selected:
      </p>

      <SimpleTable
        headers={["Setting", "Description"]}
        rows={[
          ["Terminal Sessions", "PTY terminal sessions - create, attach"],
          ["Skills", "SKILL.md management"],
          ["Commands", ".opencode/command/*.md"],
          ["Agents", ".opencode/agent/*.md"],
          ["Plugins", ".opencode/plugin hooks"],
          ["MCP Servers", "Model Context Protocol servers"],
          ["Tools", "AI tools - enable/disable each"],
          ["Permission Rules", "Default session permissions"],
        ]}
      />

      <h2 id="claude-code" className="text-xl font-semibold mb-4 mt-10">Claude Code Section</h2>
      <p className="text-muted-foreground mb-4">
        Only visible when Claude Code is selected:
      </p>

      <SimpleTable
        headers={["Setting", "Description"]}
        rows={[
          ["Settings", "Language, gitignore, channel"],
          ["Skills", "SKILL.md management"],
          ["Commands", ".claude/commands/*.md"],
          ["Hooks", "hooks.json management"],
          ["MCP", ".mcp.json configuration"],
          ["Subagents", "Custom subagent definitions"],
          ["Custom Tools", "HTTP APIs, scripts, and more"],
          ["Plugins", "Commands, skills, hooks, MCP"],
        ]}
      />

      <h3 id="subagents" className="text-lg font-medium mb-3 mt-6">Subagents</h3>
      <p className="text-muted-foreground mb-4">
        Create custom subagent definitions:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Subagent list</strong> - View all definitions</li>
        <li><strong>Create/Edit</strong> - Define new subagents</li>
        <li><strong>Delete</strong> - Remove subagent</li>
      </ul>

      <h3 id="custom-tools" className="text-lg font-medium mb-3 mt-6">Custom Tools</h3>
      <p className="text-muted-foreground mb-4">
        Define your own tools:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>HTTP tools</strong> - API endpoints as tools</li>
        <li><strong>Script tools</strong> - Local scripts as tools</li>
        <li><strong>Enable/Disable</strong> - Toggle each tool</li>
      </ul>

      <h2 id="codex" className="text-xl font-semibold mb-4 mt-10">Codex Section</h2>
      <p className="text-muted-foreground mb-4">
        Only visible when Codex is selected:
      </p>

      <SimpleTable
        headers={["Setting", "Description"]}
        rows={[
          ["Skills", "SKILL.md management"],
          ["Agents", "AGENTS.md configuration"],
          ["MCP", "Servers and configuration"],
        ]}
      />

      <h2 id="voice" className="text-xl font-semibold mb-4 mt-10">Voice Input</h2>
      <p className="text-muted-foreground mb-4">
        Use speech-to-text to dictate messages to your AI agent. Voice input is entirely optional and off by default.
      </p>

      <SimpleTable
        headers={["Setting", "Description"]}
        rows={[
          ["STT Provider", "Choose Groq (fast, free tier) or OpenAI Whisper"],
          ["API Key", "Your own API key for the chosen provider (stored encrypted on-device)"],
          ["Test Key", "Validate your API key works before saving"],
        ]}
      />

      <Callout type="info" title="Privacy Note">
        Voice audio is sent directly from your phone to the STT provider you choose (Groq or OpenAI),
        using your own API key. No audio data passes through Broski or the bridge. If you don&apos;t
        configure voice input, no audio is ever recorded or sent anywhere.
      </Callout>

      <h2 id="account" className="text-xl font-semibold mb-4 mt-10">AI Usage</h2>

      <h3 id="subscription" className="text-lg font-medium mb-3 mt-6">Provider Usage</h3>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>API limits</strong> - Current Claude / OpenAI / Codex usage vs limits</li>
        <li><strong>Credits</strong> - Remaining balance on your AI provider</li>
      </ul>

      <h2 id="support" className="text-xl font-semibold mb-4 mt-10">Support Section</h2>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Setup Guide</strong> - Opens broskiapp.com/docs/setup</li>
        <li><strong>Contact Support</strong> - Email broskiappp@gmail.com</li>
      </ul>

      <h2 id="legal" className="text-xl font-semibold mb-4 mt-10">Legal Section</h2>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Privacy Policy</strong> - How we handle your data</li>
        <li><strong>Terms of Service</strong> - Usage terms and conditions</li>
      </ul>

      <h2 id="about" className="text-xl font-semibold mb-4 mt-10">About Section</h2>

      <h3 id="replay-onboarding" className="text-lg font-medium mb-3 mt-6">Replay Onboarding</h3>
      <p className="text-muted-foreground mb-4">
        See the first-launch experience again. This:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li>Resets the onboarding flow</li>
        <li>Clears current connection</li>
        <li>Shows setup flow from the beginning</li>
      </ul>

      <h3 id="clear-cache" className="text-lg font-medium mb-3 mt-6">Clear Cache</h3>
      <p className="text-muted-foreground mb-4">
        Delete all cached data:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li>Sessions and messages</li>
        <li>File browser history</li>
        <li>Offline data</li>
        <li>Connection settings are preserved</li>
      </ul>

      <Callout type="warning" title="Clear Cache">
        Clearing cache will delete all offline data. You'll need to be connected to 
        load sessions again.
      </Callout>

      <h3 id="version" className="text-lg font-medium mb-3 mt-6">Version</h3>
      <p className="text-muted-foreground mb-4">
        Shows the current installed app version.
      </p>

      <h2 id="next" className="text-lg font-semibold mb-4 mt-10">Next</h2>
      <CardGrid>
        <Card href="/docs/app" title="App Overview" description="Navigation and gestures" />
        <Card href="/docs/bridge/configuration" title="Bridge Configuration" description="Server settings" />
      </CardGrid>
    </article>
  );
}
