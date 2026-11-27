# Adding a New Coding Agent

Broski separates the phone UI from individual coding agents through a single open contract (`packages/bridge/src/contract/`). Neither the iOS app nor the Android app branches on which agent is running — they render strictly from declared capabilities and typed events.

That means you can add a new agent either as a built-in adapter under `packages/bridge/src/backends/<id>/` or as an external plugin loaded from `~/.broski/config.json`, and both native phone apps will immediately support it with zero app changes.

## Choose an integration tier

Pick the simplest tier that matches what the agent exposes:

| Tier | Best for | What you build |
|---|---|---|
| **Tier 0 — ACP agent** | Agents speaking the Agent Client Protocol (`agy acp`, `gemini --acp`, `agent acp`, `opencode acp`, `codex-acp`, etc.) | An adapter on the agent-neutral ACP v1 client in `backends/antigravity/acp/` (it moves to `adapter-kit/` when a second ACP agent arrives), plus the agent's own processes, catalog, asks and quirks — see Antigravity |
| **Tier 1 — Minimal native adapter** | Custom CLIs, SDKs, or HTTP/JSON-RPC agents | Chat, streaming text, and tools with optional traits off; `BridgeCore` automatically supplies queue, steering, and portable fork fallbacks |
| **Tier 2 — Full native adapter** | Agents with rich native APIs (e.g. `codex app-server`, `opencode serve`) | Native approvals, models, thinking levels, modes, compaction, usage, and session fork |
| **Tier 3 — Deep host adapter** | Full terminal-to-phone handoff (like the built-in Claude Code and Pi adapters) | Watch-only terminal mirroring, `/hook/<backend>` permission forwarding, and detached restart-surviving processes |

## Directory layout and layer rules

Built-in adapters live in `packages/bridge/src/backends/<id>/`, where `<id>` is a lowercase slug (`^[a-z0-9][a-z0-9-]{0,63}$`):

```text
packages/bridge/src/backends/<id>/
  factory.ts     exports <id>BackendFactory(...) -> BackendFactory
  backend.ts     implements AgentBackend
  traits.ts      declares honest BackendTraits + BackendMeta
  status.ts      checks binary/auth without throwing
  live/          OpenSession, SessionControl, stream mapping
  store/         listSessions, getSession, readTranscript
```

Layer boundaries are enforced by `bun run check:layers` (`packages/bridge/scripts/contract-gen/layers.ts`):

- An adapter may import only `contract/` (not `contract/testing/`), `adapter-kit/`, itself, `zod`, `node:` built-ins (except `node:module`), and its own SDK (listed in `BACKEND_SDKS`).
- An adapter never imports `core/`, `server/`, or another adapter's directory, and never touches sockets or phones directly.
- Always drive the user's installed binary (from config or the login shell's `PATH`). Never bundle an agent binary or override the user's own config, extensions, or permissions.

## Minimal `AgentBackend` skeleton

Use `adapter-kit/` for shared plumbing (`phoneText`, page cursors, asks ledger, image cache and image reads, trash helpers, a JSONL stdio child with its stop ladder, `--version` reading, bounded JSON, unified diffs, rejections, a session's live state, the `FileLock` and `ImageFitter` ports, and a watch-only view that promotes itself once a terminal lets go of a session) and let `BridgeCore` supply fallbacks for any capability you leave off:

```ts
import type { AgentBackend, BackendFactory, BackendTraits } from "../../contract";
import { emptySnapshot } from "../../contract";

export const TRAITS: BackendTraits = {
	streamText: true,
	streamThinking: false,
	promptModes: ["start"], // BridgeCore adds queue/steer fallbacks automatically
	attachments: [],        // Add "image" only when readAttachment returns exact bytes
	commands: false,
	queue: false,
	interactions: [],       // Add "tool_permission" only for real harness enforcement
	thinking: false,
	children: false,
	usage: false,
	planProposals: false,
	externalLive: false,
	extensions: [],
};

export function myAgentBackendFactory(deps: MyAgentDeps): BackendFactory {
	return async (host) => {
		const backend: AgentBackend = {
			id: "my-agent",
			meta: {
				displayName: "My Agent",
				accentHex: "#0EA5E9",
				iconHint: "generic",
			},
			traits: TRAITS,
			async status() {
				// Never throw: return usable: false and actionable issues instead.
				return probeInstall(deps.cliPath);
			},
			listSessions: (query, page) => store.list(query, page),
			getSession: (ref) => store.get(ref),
			readTranscript: (ref, page) => store.transcript(ref, page),
			readAttachment: async () => ({
				status: "rejected",
				rejection: { code: "not_found", message: "Attachments not supported" },
			}),
			listModels: async () => ({ status: "accepted", models: [] }),
			listCommands: async () => ({ status: "accepted", commands: [] }),
			listModes: async () => ({ status: "accepted", modes: [] }),
			open: (target, sink) => live.open(target, sink, host),
			dispose: () => live.dispose(),
		};
		return backend;
	};
}
```

## Five invariants every adapter must keep

1. **Snapshot before events.** Never call `sink.emit()` before `open()` resolves with its initial `SessionSnapshot`. Afterward, every emitted record must fold through `applyEvent()` so `session.snapshot()` always matches the stream.
2. **Idempotent prompts by `clientRequestId`.** Remember accepted `clientRequestId` values per open session and return the original `PromptResult` on duplicates. Never cache rejections (`busy`, `invalid_input`). Echo `clientRequestId` on live `user_message` events and in `readTranscript`.
3. **Balanced stream lifecycles.** Every `run_started` ends with exactly one `run_finished`. Every open `block_started` and `tool_started` closes before `run_finished`, even on abort or crash. Never reuse `runId`, `blockId`, `toolCallId`, or `interactionId` inside a session.
4. **No overlap between live runs and saved transcripts.** While a run is active, `readTranscript` stops strictly before that run's first item. Once `run_finished` fires, the finished run appears in `readTranscript`.
5. **Non-destructive `close()`.** `OpenSession.close()` detaches the sink and rejects later `control.*` calls with `closed`. It must never abort a running turn or auto-deny a pending ask.

## Using Bridge MCP from an adapter

If your agent speaks MCP and lacks native phone questions, plan approvals, or status notices, issue a per-session scoped token from the bridge's loopback MCP server (`/mcp`). See [`docs/bridge-mcp.md`](bridge-mcp.md) for the exact tools, capability flags, and prompt-cache rules.

Two strict rules apply:

- **Never put tool permissions behind MCP.** `Approve` / `Deny` must intercept execution inside the agent harness itself.
- **Never duplicate native tools.** If the agent already has a native question or plan tool (like Claude Code's `AskUserQuestion` and `ExitPlanMode`), disable `ask` / `plan` on its MCP lease.

## Shipping as an external plugin

External adapters do not require forking Broski. Export `createBroskiAdapter` from a package using `broski-bridge/plugin`:

```ts
import type { BackendFactory, BroskiPluginContext } from "broski-bridge/plugin";

export function createBroskiAdapter(ctx: BroskiPluginContext): BackendFactory {
	return async (host) => {
		// Use ctx.config, ctx.env, ctx.mcp, ctx.fitImage, ctx.stateDir, ctx.log
		return buildBackend(ctx, host);
	};
}
```

Users install the plugin into `~/.broski/adapters` (or point to a local path) and register it in `~/.broski/config.json`:

```json
{
	"adapters": [
		{ "id": "example", "module": "broski-adapter-example", "enabled": true }
	]
}
```

Bare package names resolve strictly from `~/.broski/adapters/node_modules` (`bun add --cwd ~/.broski/adapters broski-adapter-example`). After restarting the bridge, the new agent appears automatically in both phone apps.

## Conformance testing and verification

Every adapter must pass the 28-rule conformance suite (`packages/bridge/src/contract/testing/run-conformance.ts`) against a **real local agent process and scripted model endpoint** — never a mock of the core or the agent.

Antigravity is the exception: `agy` could be put on a scripted model only with a fake API key, so its conformance run, live suite and frame recorder run on the user's real `agy` alone, opt-in on the developer's own sign-in (`BROSKI_TEST_AGY=1`, `BROSKI_AGY_RECORD=1`). CI starts no `agy`: its frame-level tests run on ACP's documented records, and `jobs_shutdown` on a stand-in process that hangs and speaks no ACP.

Use the built-in adapters as reference implementations:

- `packages/bridge/src/backends/claude-code/` and `packages/bridge/src/__tests__/claude-code/conformance/conformance.test.ts`
- `packages/bridge/src/backends/pi/` and `packages/bridge/src/__tests__/pi/conformance.test.ts`
- `packages/bridge/src/backends/antigravity/` (an ACP agent) and `packages/bridge/src/__tests__/antigravity/conformance/conformance.test.ts`; notes in [`docs/architecture/backends/antigravity/README.md`](architecture/backends/antigravity/README.md)

Before opening a PR or publishing a plugin, verify:

1. No test touches `~/.broski`, `~/.claude`, or `~/.pi` (`safety/real-home-guard` enforces this).
2. Every wire string and list stays inside `packages/bridge/src/contract/limits.ts` and passes through `adapter-kit/phone-text.ts`.
3. Pending interactions wait indefinitely until a human answers/cancels, the agent withdraws them, or the process exits — never auto-answer on a timeout.
4. Watch-only terminal sessions expose `OpenSession.answer` without `control` so the phone never races a terminal as a second writer.
5. All checks pass in `packages/bridge`: `bun run typecheck`, `bun run lint`, `bun run check:layers`, `bun run contract:check`, and `bun test`.

For deeper reference specs, see [`docs/architecture/contract/README.md`](architecture/contract/README.md) and [`docs/architecture/core/README.md`](architecture/core/README.md).
