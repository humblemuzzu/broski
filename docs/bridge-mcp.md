# Bridge MCP Tools (`/mcp`)

The Broski bridge runs an authenticated, loopback-only HTTP MCP server at `https://127.0.0.1:<port>/mcp` (`packages/bridge/src/mcp/` and `packages/bridge/src/server/bridge-mcp.ts`).

It gives coding agents a clean way to reach your phone for structured interactions that their own harness does not provide natively, without duplicating tools they already have.

## Available tools

Each tool is gated by a per-session capability flag on its token (`packages/bridge/src/mcp/tools.ts`):

| Tool | Capability | Blocks run? | What it does |
|---|---|---|---|
| `broski_ask` | `ask` | Yes | Shows structured single- or multi-select questions (with optional custom text or secret input) on your phone and waits for your answers. Never for tool permissions. |
| `broski_propose_plan` | `plan` | Yes | Sends a Markdown plan to your phone for approval, revision feedback, or inline edits, and waits for your decision. |
| `broski_notify` | `notify` | No | Sends a short, non-blocking status update to the session's stream on your phone (with optional `urgency: "high"`). |

## How each built-in agent uses it

Broski avoids giving an agent two tools that do the same thing:

- **Claude Code** receives `broski_notify` only (`packages/bridge/src/server/claude-code-mcp.ts`), delivered through the SDK `initialize` handshake (`mcpServersDelivery: "initialize"`) and pre-allowed via `allowedTools: ["mcp__broski__broski_notify"]`. Claude Code already has native `AskUserQuestion` and `ExitPlanMode`, so `ask` and `plan` are kept off to prevent tool duplication.
- **Pi** handles `broski_ask` natively inside its host extension (`packages/bridge/src/backends/pi/host/extension/ask.ts`), rather than over HTTP MCP, so it works inside Pi's detached holder across bridge restarts. If one of your own Pi extensions already announces a phone-capable question tool (`broski:ask-tool`), Broski suppresses `broski_ask` automatically so the model never sees two competing ask tools.
- **Antigravity** receives none: every session opens with `mcpServers: []`. `agy` advertises no HTTP MCP, and its own `ask_question` tool already brings its questions to the phone (`packages/bridge/src/backends/antigravity/live/questions.ts`).
- **Plugin and future adapters** receive a `BroskiMcpIssuer` in `BroskiPluginContext.mcp` and can grant any combination of `{ ask, plan, notify }` that their agent lacks natively.

## Configuration

`broski_notify` is enabled by default. To disable it in `~/.broski/config.json`:

```json
{
	"bridgeTools": {
		"notify": false
	}
}
```

Restart the bridge (`broski restart`) after editing the config.

## Security and prompt-cache rules

- **Loopback only:** `/mcp` refuses any request that does not originate from `127.0.0.1` / `::1`.
- **Per-session bearer tokens:** Each hosted session receives a unique token bound strictly to its `(backend, sessionId)` and capability set (`packages/bridge/src/mcp/session-tokens.ts`). Tokens are passed in HTTP headers — never on the command line — and revoked immediately when the session closes or the bridge stops.
- **TLS trust:** When the loopback listener uses TLS (default; forced in compiled builds), Claude Code trusts the bridge's CA via `NODE_EXTRA_CA_CERTS`. If your shell environment already sets `NODE_EXTRA_CA_CERTS` to another file, Broski leaves it untouched and skips attaching the MCP server rather than breaking your CA bundle.
- **Keep tool lists frozen:** Never add or remove MCP tools mid-conversation; changing tool declarations invalidates prompt caching.
- **No timeouts on human answers:** `broski_ask` and `broski_propose_plan` stream SSE heartbeats while waiting and resolve only when you answer or cancel, or when the run/session ends.
