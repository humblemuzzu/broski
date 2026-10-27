# OpenClaw agent interoperability architecture

**Session ID:** ses_3b6254c7effe3qM3oMf2V7B537
**Created:** 2/11/2026, 4:49:55 AM
**Updated:** 2/11/2026, 5:37:45 AM

---

## User

so this @reference/openclaw/ personal ai assitant got too much famous and all people use it kinda and building apps wraper and all on top of it and its now widley used [Image 2] and see this image from a yc partner coz its true people are building for ai so another user or anyone can command their ai their openclaw to use other peopls products kinda so can u launch a subagent and check how openclaw is and how it connects to other agents and all shi and like its architecure and all shi kinda cli and all and launch another subagent on our bridge and all how we build it and all shi our architecure and all and explain and take decision like a googles top level architecureal engieer would on how and what we should do so other people i mean our users ai can use our binary via command or our app which is kinda impossible but i think in figuring out a solutino for anything no BS but real and robust kidna and how and what we should do so another ai agents openclaw can use our whole system coz the user is paying to use our platform soofc their agent should be abel to use us kidna spin up many sesison of diff ai backends with customziations and all shi kinda and do way more than i cna imagine usecases in my mind so explaina nd give me an overview on what im thinking and clear my thought process with eghs and stuff and verdict and reasonoing against why wont the ai aents use the coding agents we support their cli which are already out there and why our broski stuff we can develop kidna what robust we can have that they cant do kidna shi explain after ur done with ur research

---

## Assistant (Build · claude-opus-4-6 · 11.2s)

_Thinking:_

The user wants me to:

1. Research OpenClaw's architecture - how it connects to other agents, its CLI, how it works
2. Research our Broski bridge architecture
3. Think like a top-level Google architectural engineer about how we should make Broski accessible to other AI agents (like OpenClaw)
4. Explain the "agent-to-agent" paradigm shift shown in the tweet (building software for agents, not humans)
5. Give a clear verdict on why AI agents would use Broski instead of directly using the CLIs of the coding agents we support

Let me launch subagents to research both codebases in parallel, then synthesize.

Let me launch parallel research subagents to deeply understand both OpenClaw and our Broski architecture, then I'll synthesize a strategic analysis.

**Tool: todowrite**

---

## Assistant (Build · claude-opus-4-6 · 254.7s)

**Tool: task**

**Tool: task**

---

## Assistant (Build · claude-opus-4-6 · 11.3s)

Now let me update the todos and synthesize the strategic analysis.

**Tool: todowrite**

---

## Assistant (Build · claude-opus-4-6 · 83.0s)

Alright. Both subagents are done. Here's the full strategic analysis.

---

# The Paradigm Shift You're Seeing

Aaron Epstein's tweet nails it: **we're moving from building software for humans to building software for agents**. Locus built payments-for-agents. OpenClaw built an OS-for-agents. The question is: where does Broski fit in this world?

---

## What OpenClaw Actually Is (Architecturally)

OpenClaw is a **local-first message bus + agent runtime + device control plane**. Its core is the "Gateway" -- a single Node.js process that:

1. **Channels** (inbound): Telegram, WhatsApp, Slack, Discord, Signal, iMessage, Teams, Matrix -- all funnel into one agent
2. **Agent runtime**: Routes messages to an LLM (Anthropic, OpenAI, xAI, Ollama) with tool calling
3. **Nodes** (outbound): macOS/iOS/Android apps that connect as "device nodes" and can run shell commands, control browsers, take screenshots, record screen
4. **Skills**: Plugin system where third parties write `SKILL.md` files that get injected into the agent's prompt, teaching it new capabilities
5. **ClawHub**: A skill marketplace (`npx clawhub install <skill>`) for community skills

The key insight: **OpenClaw's skill system is exactly how external products integrate**. Locus (from the tweet) built an OpenClaw skill that teaches the agent how to hire freelancers and make payments. The agent reads the SKILL.md, learns the API, and can now do payments. The user's OpenClaw can now do something it couldn't before -- because a third party published a skill.

---

## What Broski Is (From the Agent's Perspective)

Broski is a **multi-agent orchestration bridge** that:

1. Connects to 4 AI backends simultaneously (Claude Code, Codex, OpenCode, Pi)
2. Exposes ~175 WebSocket message types covering: chat, sessions, file system, Git, GitHub, PTY terminals, MCP servers, skills, plugins, hooks, dev server proxy
3. Runs on the user's machine as a binary (`bunx broski-bridge`)
4. Is controlled from a mobile app (Flutter) over authenticated WebSocket

The unique value that raw CLIs don't have:
- **Unified multi-agent**: One protocol to control Claude Code + Codex + OpenCode + Pi
- **Remote access**: Full control from anywhere (phone, over LAN or an end-to-end encrypted relay)
- **Multi-device**: Multiple phones/tablets connected simultaneously
- **Orchestration**: Run multiple agent sessions across different backends concurrently
- **Integrated workflows**: File browsing + Git + GitHub + PTY + dev preview all in one

---

## Your Question Clarified

You're asking: **How do we make it so that when a user's OpenClaw (or any personal AI) wants to do coding work, it uses Broski as the tool -- not the raw CLIs directly?**

And the critical sub-question: **Why would an AI agent choose Broski over just running `claude-code` or `codex` directly?**

---

## The Honest Argument: Why NOT Broski? (Steel-Manning the Opposition)

An OpenClaw agent can already do this TODAY:

```
User: "Hey, refactor my auth module"
OpenClaw: *runs `claude-code --print "refactor the auth module"` via its node's shell*
```

No Broski needed. Claude Code's CLI already works. Codex's CLI already works. OpenClaw has shell access via its node system. So why would they route through Broski?

**Reasons an agent might skip Broski and use raw CLIs:**
- Fewer moving parts (no bridge to install/run)
- Direct stdio communication (no WebSocket overhead)
- Already supported by Claude Code's `--print` mode, Codex's `app-server` mode
- The agent gets the same output either way

This is a real argument. You need a real counter.

---

## The Real Counter: Why Broski Wins for Agent-to-Agent

Here's where Broski has a **structural advantage** that raw CLIs cannot replicate:

### 1. Multi-Agent Orchestration (The Killer Feature)

Raw CLI: An OpenClaw skill can spawn `claude-code` OR `codex`. One at a time. If the task needs both, the skill author has to build the orchestration logic themselves.

**Broski**: The bridge already manages concurrent sessions across all 4 backends. An OpenClaw skill that talks to Broski can:
- Spin up Claude Code on the auth module
- Simultaneously spin up Codex for code review
- Simultaneously spin up OpenCode for running tests
- Get unified streaming from all three
- Act on the combined results

No skill author can replicate this with raw CLIs. The orchestration is already built.

### 2. Session Persistence & Management

Raw CLI: `claude-code --print` is stateless. Each invocation is a new session. No history, no fork, no resume. The Codex CLI doesn't even expose session management to external callers.

**Broski**: Full session lifecycle -- create, list, resume, fork, revert, rename, delete, background, share. An agent can start a session, pause it, come back tomorrow, fork it to try a different approach, revert if it failed.

### 3. Permission Handling

Raw CLI: `claude-code --print` runs in `--dangerously-skip-permissions` mode by default, or blocks waiting for terminal input. Neither works well for agent-to-agent.

**Broski**: The bridge has a full permission request/response protocol. An upstream agent (OpenClaw) can receive permission requests, evaluate them against its own policies, and respond programmatically. This is the only safe way to give an AI agent control of another AI agent.

### 4. Real-Time Streaming With Structured Events

Raw CLI: stdout text. You get raw text and have to parse it.

**Broski**: Typed, structured streaming events -- `assistant-message-delta`, `thinking-delta`, `tool-call`, `tool-result`, `token-usage`, `checkpoint-created`, `permission-request`. An upstream agent can react to specific events (e.g., abort if token usage exceeds budget, approve specific tool calls, inject context when the agent gets stuck).

### 5. File System + Git + GitHub as First-Class Protocol

Raw CLI: File operations require separate shell commands (`cat`, `git status`, `gh pr list`).

**Broski**: ~30 file/git/github message types already built into the protocol. An upstream agent can browse files, read code, check git status, stage changes, create commits, open PRs -- all through the same WebSocket connection it uses for chat. No shell command parsing.

### 6. Dev Server Preview

Raw CLI: Cannot preview what the agent is building.

**Broski**: The `/proxy/:port` endpoint lets an upstream agent (or its user) preview the running dev server in real time. An OpenClaw agent could take a screenshot of the preview and decide if the UI looks right.

---

## The Strategic Play: What to Build

Here's what I'd recommend, thinking like a principal architect:

### Phase 1: Broski as an OpenClaw Skill (Quick Win, High Impact)

Build an OpenClaw skill: `~/.openclaw/workspace/skills/broski/SKILL.md`

This skill teaches OpenClaw how to talk to the Broski bridge. The SKILL.md would:
- Describe all available capabilities
- Explain the WebSocket protocol
- Provide tool schemas for key operations

But skills are prompt-only -- they can't actually make WebSocket connections. So you also need:

### Phase 2: Broski CLI Agent Mode (The Real Product)

Add a new mode to the bridge binary:

```bash
broski-bridge agent-api --format jsonrpc
```

This exposes the bridge's capabilities via **JSON-RPC over stdio** -- the universal protocol for tool communication that MCP, Codex, and language servers all use.

Why stdio JSON-RPC:
- OpenClaw's node system already speaks this (its nodes are child processes with command dispatch)
- It's what MCP servers use
- It's what Codex's `app-server` uses
- Any AI agent runtime can spawn a child process and talk JSON-RPC
- No WebSocket client needed, no auth needed (parent process = trusted)

The JSON-RPC methods would map 1:1 to your existing WebSocket message types:

```json
{"jsonrpc": "2.0", "method": "cc.chat", "params": {"prompt": "refactor auth", "cwd": "/project"}, "id": 1}
{"jsonrpc": "2.0", "method": "cc.listSessions", "params": {"cwd": "/project"}, "id": 2}
{"jsonrpc": "2.0", "method": "cx.chat", "params": {"prompt": "review this PR"}, "id": 3}
{"jsonrpc": "2.0", "method": "pty.create", "params": {"cwd": "/project"}, "id": 4}
{"jsonrpc": "2.0", "method": "git.status", "params": {"path": "/project"}, "id": 5}
```

Streaming responses via JSON-RPC notifications:

```json
{"jsonrpc": "2.0", "method": "cc.stream", "params": {"type": "assistant-message-delta", "text": "..."}}
```

### Phase 3: Broski as an MCP Server (Maximum Reach)

MCP (Model Context Protocol) is becoming the standard for tool integration. If Broski exposes its capabilities as an MCP server, **every AI agent that supports MCP can use Broski automatically** -- no custom integration needed.

```bash
broski-bridge mcp-server
```

MCP tools exposed:
- `broski_chat` -- Send prompt to any backend (claude-code, codex, opencode, pi)
- `broski_list_sessions` -- List sessions across all backends
- `broski_resume_session` -- Resume an existing session
- `broski_browse_files` -- Browse project files
- `broski_git_status` / `broski_git_commit` / etc.
- `broski_create_terminal` / `broski_terminal_exec`
- `broski_orchestrate` -- Multi-agent task (the real differentiator)

This means Claude Code, Codex, OpenCode, OpenClaw, Cursor, Windsurf -- any MCP-capable agent -- can use Broski as a tool.

### Phase 4: The Broski Orchestration Primitive

This is what no one else has and can't easily build:

```json
{
  "method": "broski.orchestrate",
  "params": {
    "tasks": [
      {"agent": "claude-code", "prompt": "implement the feature in src/auth/", "cwd": "/project"},
      {"agent": "codex", "prompt": "review the changes in src/auth/", "cwd": "/project", "dependsOn": [0]},
      {"agent": "opencode", "prompt": "run the test suite and fix failures", "cwd": "/project", "dependsOn": [1]}
    ],
    "policy": {
      "permissions": "ask",
      "maxTokenBudget": 100000,
      "timeout": 600
    }
  }
}
```

One call. Three agents. Dependency-chained. Budget-capped. Permission-gated. No other tool can do this because no other tool connects to all four backends simultaneously.

---

## Verdict & Reasoning

### Why won't agents just use the raw CLIs?

They **will** for simple cases. "Ask Claude Code to fix this bug" -- yeah, just run the CLI. But:

1. **Multi-agent is impossible with raw CLIs.** There is no CLI command that says "run Claude Code AND Codex AND pipe the results together." That orchestration doesn't exist anywhere except Broski.

2. **Session management is impossible with `--print` mode.** You can't resume, fork, or revert a `claude-code --print` session. It's fire-and-forget. Real agent workflows need persistence.

3. **Permission handling is broken with raw CLIs.** Either you skip permissions (dangerous) or you block on stdin (can't automate). Broski's permission protocol is the only programmatic solution.

4. **Structured streaming doesn't exist on stdout.** Raw CLI output is text. Broski gives typed events an agent can react to programmatically (abort on budget, approve tools, inject context).

5. **The overhead argument is wrong.** Broski bridge is already running on the user's machine (the user is a Broski subscriber). There's zero setup cost for the upstream agent -- just connect. Raw CLIs actually have MORE overhead because each invocation spawns a new process, loads the SDK, initializes auth.

### What Broski uniquely provides (that nobody else can):

| Capability | Raw CLIs | Broski |
|---|---|---|
| Multi-agent orchestration | Not possible | Built-in |
| Session persistence across agents | Agent-specific, limited | Unified |
| Programmatic permissions | Skip or block | Full protocol |
| Structured event streaming | No | 170+ typed events |
| File/Git/GitHub integration | Shell commands | First-class protocol |
| Dev server preview | No | Built-in proxy |
| Token budget control | Per-agent only | Cross-agent |
| Remote access | No | Noise end-to-end over LAN or relay |

### The Bottom Line

**Broski should become an MCP server + JSON-RPC stdio tool.** The bridge already has all the orchestration logic built -- ~175 message types, 4 agent connectors, file system, git, PTY. You just need a new transport layer (stdio JSON-RPC and/or MCP) that exposes the same capabilities to upstream AI agents instead of only to the Flutter app.

The moat is **multi-agent orchestration with unified session management and programmatic permission handling.** No one else has this. Claude Code's CLI can't control Codex. Codex's CLI can't control Claude Code. Only Broski sits in the middle of all four. That's the product for agents.

**Tool: todowrite**

---

## Assistant (Build · claude-opus-4-6 · 8.3s)

That's the full analysis. The TL;DR execution order if you want to act on this:

1. **Fastest win**: `broski-bridge mcp-server` mode -- expose key bridge capabilities as MCP tools. Every MCP-compatible agent (including Claude Code itself, OpenClaw, Cursor, etc.) can immediately use Broski.
2. **Highest leverage**: `broski.orchestrate` primitive -- the multi-agent DAG executor. This is the feature no one else can build because no one else has all four connectors.
3. **Widest reach**: Publish an OpenClaw skill on ClawHub that teaches any OpenClaw instance how to use Broski's MCP server.

---

## User

i want more in depth lol the 6 points u said those are non blockrs ai agents can alrady do that spin up 100s of sessino and all after all were using their sdk lol but i love the cli mcp skill and plan u said but we want smth not smth way but way more robust type shi that using broski gives them that thing that they will not get anywhere else way mroe robust easy to use and can simplify the users work so easily n shi we need winning points bro so whats those for ai agents bro? think about it dont rush

---

## Assistant (Build · claude-opus-4-6 · 1507.7s)

_Thinking:_

The user is pushing back on my initial analysis - rightly so. They're saying the 6 points I listed (multi-agent, session persistence, permissions, streaming, file/git, dev preview) are NOT real differentiators because AI agents can already do all of that by using the raw SDKs directly. They can spin up 100 sessions, they can manage permissions, they can stream, etc.

The user wants me to think DEEPLY about what Broski uniquely provides that is genuinely impossible or extremely hard to replicate by just using the raw CLIs/SDKs. They want the REAL winning points - the things that make Broski indispensable for agent-to-agent workflows.
 
So I need to flip my perspective - instead of listing what Broski CAN do, I should think about what an agent would struggle with if it tried to replicate Broski's functionality using only the raw tools. What's the friction point that Broski actually solves?

The real differentiator is that human oversight layer on mobile. An AI agent with shell access can technically do everything Broski does, but it can't give the user real-time visibility and control from their phone - that's the architectural advantage Broski provides. The human becomes an active participant in the workflow, able to observe, approve, and redirect the agent's actions in real-time rather than just getting a final result.

Beyond that, there's the observability angle: when an agent like OpenClaw spawns work through Broski, everything shows up on the user's phone automatically instead of requiring them to dig through terminal logs. And when multiple AI tools work together through Broski, they can share context and handoff work seamlessly, which is harder to coordinate when agents are operating independently. the FULL context of both sessions. It can pass file diffs from Claude Code directly to Codex without the upstream agent having to manage that plumbing. The bridge IS the shared memory.

4. **The user's existing sessions and project context.** The user already has Broski running with their projects loaded, their sessions active, their configs set, their MCP servers connected. An external agent tapping into Broski gets ALL of that context for free. If they spawn a fresh claude-code CLI, they get nothing - cold start.

5. **Entitlement/billing unification.** The user pays for Broski. Broski tracks usage across all agents. External agents using Broski automatically get usage tracking, budget limits, rate limiting. Raw CLIs have no cross-agent budget management.

6. **The dev server proxy.** This is actually unique - no CLI can show an AI agent what the app looks like. Broski's proxy plus potential screenshotting means an agent could visually verify its work.

7. **The "warm" bridge.** Broski is already running, already connected to all backends, already authenticated, already has the project context loaded. Spawning a fresh CLI is a cold start every time - auth, project detection, context loading. Broski is instant.

Now I'm stepping back to think about this more fundamentally. What are the actual problems an external AI agent faces when trying to do coding work? There's the cold start issue where every new invocation starts from scratch, the lack of observability so the user can't see what's happening, no governance to approve or steer the work, and no continuity between invocations since each one is isolated. are the human-in-the-loop governance from mobile—that's the real trust layer that makes autonomous workflows safe—plus the warm, pre-configured environment where an external agent gets all the API keys, models, and project setup for free instead of configuring from scratch, and the unified state across all agent sessions so you can query what happened in previous runs.

The phone becomes the approval device for dangerous actions in a world where agents spawn other agents, and the real power is orchestrating multiple agents simultaneously while keeping the human in the loop on their mobile device to observe, steer, and approve in real time.

So the product case is clear: Broski is the user's trusted execution environment for coding work—already running, authenticated, connected to their preferred agents with custom configs, and with the phone as the control and approval mechanism. When external agents need coding done, they should delegate to Broski the same way a program delegates crypto signing to a hardware security key, because that's where the user's trust and authorization actually lives. It's like OpenClaw is the brain, Broski is the hands with trust controls, and the phone is the eyes watching everything.

Beyond the conceptual framing, there are some genuinely hard technical advantages: Broski already has deep project intelligence—directory structure, git state, open sessions, MCP servers, recent activity—that an external agent would need multiple CLI calls to gather. When multiple agents work on the same project, Broski can show the aggregate diff across all of them, whereas raw CLIs scatter changes across separate sessions. And the phone notification system means long-running agent tasks can notify the user when they complete, fail, or need approval.

Now I'm thinking about what we could build into Broski to make it the obvious choice—not just what we have today, but the vision. An Agent Sandbox Mode where external agents run in an isolated environment with file writes staged for user approval before committing to the actual project. A Cost Governor that lets users set spending limits on agent operations.

A Project Context API so agents can query the current state without running a dozen commands. Session Replay to rerun past agent actions on different branches. And Multi-agent Pipelines with automatic context passing between stages and human checkpoints. I think I have enough now to write a really solid analysis.

You're right. I was being lazy with those 6 points. An AI agent with shell access and the SDK can already do most of that. Let me actually think.

Let me go deeper into what Broski's bridge actually does at the connection level -- the stuff that's hard to see from a feature list.

**Tool: task**

**Tool: task**

---

## Assistant (Build · claude-opus-4-6 · 248.0s)

Good. The first subagent returned old context from our Pi work (it read CONTINUITY.md), but the second one gave me exactly what I needed about OpenClaw. Let me now also get the bridge internals I need:

**Tool: task**

---

## Assistant (Build · claude-opus-4-6 · 9.0s)

**Tool: todowrite**

---

## Assistant (Build · claude-opus-4-6 · 79.7s)

OK. Now I've gone deep enough. Let me give you the real answer.

---

# Why Would an AI Agent Use Broski Instead of Raw CLIs?

## First: Let's Kill the Weak Arguments

You're right to push back. These are NOT real differentiators:

- "Multi-agent orchestration" -- An AI agent can spawn 100 CLI processes itself. `child_process.spawn('claude', [...])` three times. Done.
- "Session persistence" -- Claude Code stores JSONL files on disk. Codex stores threads. Any agent can read those.
- "Structured streaming" -- The SDKs already provide structured events. That's literally what SDKs do.
- "File/Git integration" -- Every agent has shell access. `git status` works fine.
- "Unified protocol" -- Nice-to-have, not a reason to add a dependency.

An AI agent with shell access is already powerful. So what does Broski ACTUALLY give them that they **cannot get** any other way?

---

## The Three Real Differentiators

### 1. The Human's Phone is in the Loop (The Trust Primitive)

This is the big one. Think about what happens when an AI agent (OpenClaw) wants to do coding work:

**Without Broski:** OpenClaw spawns `claude-code --print "refactor auth"`. Claude Code runs. It needs to delete 15 files, rewrite the database schema, and push to main. Who approves this? Nobody. Either:
- You skip permissions (`--dangerously-skip-permissions`) -- the agent has unsupervised root access to your codebase
- You block on stdin -- the upstream agent can't answer permission prompts intelligently (it doesn't know if deleting `schema.sql` is safe)
- You use `allowedTools` -- but the upstream agent has to pre-decide which tools are OK without knowing what the task will require

**With Broski:** OpenClaw sends the task to Broski. Claude Code runs. It needs to delete 15 files. The bridge routes the permission request through `ccPermissionWaiters` to the user's phone. The user sees: "Claude Code wants to delete schema.sql, users.sql, and 13 other files. Approve?" The user taps approve or reject. The Promise resolves. The SDK continues.

The user's **phone becomes a hardware approval key** for autonomous agent work. Like a YubiKey but for AI actions. The agent works autonomously EXCEPT for dangerous operations, which get routed to the human's pocket.

No raw CLI can do this. The permission callback in Claude Code's SDK is synchronous -- it blocks the query until you return a value. That return value has to come from somewhere. In a terminal, it comes from stdin. With Broski, it comes from a WebSocket message from a phone on the other side of the world. That's a fundamentally different trust model.

And it's not just Claude Code. The bridge has `cxApprovalWaiters` for Codex too. Same pattern: JSON-RPC request blocks, bridge routes to phone, user approves, bridge resolves. Both agents get human-in-the-loop governance through one device.

**Why this matters for the "software for agents" wave:** When Agent A delegates to Agent B, who watches Agent B? Today: nobody. With Broski: the user watches Agent B from their phone. This is the missing governance layer for autonomous agent chains.

### 2. The Warm, Pre-Configured Execution Environment (Zero Cold Start)

When an AI agent spawns a raw CLI:
1. Process spawns (~500ms-2s depending on the SDK)
2. Auth check (reads API key from env/config)
3. Project detection (reads `.claude/` or `.codex/` directory)
4. MCP server connections (if configured -- can take 5-30s)
5. AGENTS.md loading
6. Skills/plugins loading and eligibility checking
7. Model availability check

Every. Single. Time. For every invocation.

Broski bridge is already running. It has:
- `activeSessions` map with live SDK `query()` handles that have already done auth, project detection, and MCP connection
- `ccSupportedModelsByCwd` cached per project -- no model availability probe needed
- `ccAccountInfoByCwd` cached -- no billing/org check needed
- `codexClient` singleton -- the `codex app-server` child process is already running, already initialized, already handshaked
- `ccFsWatchers` watching `.claude/skills/`, `.claude/plugins/`, `.claude/hooks/` -- any config changes are already reflected
- `currentConfig` loaded from `~/.broski/claude-code-config.json` with the user's preferred permission mode, model, allowed tools, betas

An external agent connecting to Broski gets **instant response** because the execution environment is already warm. The user has already configured their preferred models, permission modes, MCP servers, skills, and API keys. The external agent doesn't need to know ANY of that. It just says "chat with Claude Code in /my/project" and the bridge handles everything.

This is the difference between calling an API and installing the whole stack yourself. AWS Lambda vs running your own servers. The bridge IS the managed execution environment for coding agents.

### 3. Session Continuity Across Agents and Time (The State Machine Nobody Else Has)

Here's what the bridge holds in memory that no raw CLI invocation gets:

```
ccSessionOwners    -> Who's running each Claude Code session
cxThreadOwners     -> Who's running each Codex thread
cxActiveTurns      -> What turn is active per thread
cxItemCache        -> Tool call context for approval UI
cxUndoStackByThread -> File change undo history
cxFileChangeSnapshots -> Pre-change file snapshots
sessionWatchers    -> Who else is watching each session
ccExternalTails    -> Live JSONL file tailers for CLI-started sessions
ocSessionProjectPaths -> Project path per OpenCode session
recentChatMessageIds -> Dedup guard
```

When an external agent uses Broski, it can:

1. **Resume a session the user started from their phone.** The user was chatting with Claude Code on their commute. OpenClaw picks up the same session, reads the transcript, continues the work. Try doing that with `claude-code --print` -- you can't resume a session started by the SDK from the CLI.

2. **Watch a session another agent started.** Agent A starts a Claude Code session via Broski. Agent B can `set_view` to watch the same session and get real-time stream events. The `sessionWatchers` + `ccExternalTails` system handles this automatically. Raw CLIs are completely isolated -- one process can't observe another's session.

3. **Pick up CLI-started sessions.** If the user ran Claude Code directly from terminal (not through Broski), the bridge detects this and spins up an `ccExternalTail` -- a file watcher on the JSONL session file. The external agent can watch what the user's manual CLI session is doing in real-time. No other tool provides this cross-surface observability.

4. **Undo across turns.** The `cxUndoStackByThread` + `cxFileChangeSnapshots` system takes file snapshots BEFORE each Codex tool execution. An external agent can undo specific file changes without reverting the whole session. Raw Codex CLI has undo, but it's tied to the process -- you can't undo from a different process.

---

## What OpenClaw's Integration Surface Actually Looks Like

From the deep dive into OpenClaw:

- **Skills are prompt-only.** A SKILL.md injects text into the system prompt. It does NOT register callable tools, open persistent connections, or have any runtime. The LLM reads the skill text and uses the `exec` tool (shell) to run commands.
- **Exec approval gates everything.** When a skill tells the LLM "use the `broski` CLI", OpenClaw's node checks the exec allowlist. The binary needs to be in the allowlist or the user gets prompted.
- **No native MCP support.** OpenClaw implements ACP (Agent Client Protocol), not MCP. MCP servers are explicitly ignored in their ACP translator.
- **Plugins are the power path.** OpenClaw plugins (TypeScript packages) CAN register actual tools via `api.registerTool()`, add HTTP endpoints, run background services, etc.

This means **three integration tiers for Broski**:

| Tier | What | How | Effort | Power |
|------|------|-----|--------|-------|
| 1 | OpenClaw Skill | SKILL.md that teaches the LLM to run `broski-bridge agent-api` commands | Low | Medium -- limited to shell exec, no streaming, no permission routing |
| 2 | MCP Server | `broski-bridge mcp-server` -- any MCP client connects | Medium | High -- structured tools, but still request/response |
| 3 | JSON-RPC stdio | `broski-bridge agent-api` spawned as child process | Medium | Highest -- streaming, permissions, full protocol |

---

## The Strategic Verdict

### What to build (priority order):

**1. `broski-bridge agent-api` -- JSON-RPC over stdio mode**

This is the highest-leverage move. Why:
- It's the universal child-process protocol (Codex uses it, MCP uses it, language servers use it)
- Parent process = trusted, so no auth needed (no token, no TLS)
- Supports streaming via notifications (critical for permission routing)
- Maps cleanly to your existing ~175 message types
- Works with OpenClaw (their node system spawns child processes and talks commands)
- Works with ANY agent runtime that can spawn processes

The permission flow becomes: External agent spawns `broski-bridge agent-api` -> bridge runs Claude Code -> permission needed -> bridge sends JSON-RPC notification `{method: "permission.request", params: {...}}` -> simultaneously routes to user's phone AND sends to parent process -> parent process can auto-approve OR let the phone handle it -> response comes back.

This gives the external agent a CHOICE: handle permissions itself (for automation) or let the human handle them (for safety). No raw CLI offers this.

**2. `broski-bridge mcp-server` -- MCP tool exposure**

Lower priority than stdio because MCP is request/response only (no streaming notifications for permissions). But it gives you instant compatibility with Claude Code, Cursor, Windsurf, and any MCP-capable agent.

Expose ~10 high-value tools:
- `broski_chat` -- send prompt to any backend
- `broski_resume_session` -- continue existing session
- `broski_list_sessions` -- see what's been worked on
- `broski_approve_pending` -- approve/reject pending permissions
- `broski_browse_files` / `broski_read_file`
- `broski_git_status` / `broski_git_commit`
- `broski_create_terminal` / `broski_run_command`
- `broski_get_status` -- which agents are available

**3. OpenClaw skill + plugin**

- Skill (SKILL.md): Teaches OpenClaw's LLM about Broski. "When the user asks you to do coding work, use the `broski` tool."
- Plugin (TypeScript): Registers `broski_chat`, `broski_sessions`, etc. as actual callable tools. Opens a persistent JSON-RPC connection to the bridge.
- Publish the skill on ClawHub for discoverability.

### Why This Wins (The One-Sentence Pitch):

**Broski is the only tool where an AI agent can dispatch coding work to four different coding agents, with the user's phone as the approval key, against a warm pre-configured environment, with cross-session continuity -- in one API call.**

Raw CLIs give you one cold agent with no governance. Broski gives you a managed, warm, multi-agent execution environment with human-in-the-loop from mobile. That's the moat.

**Tool: todowrite**

---

## Assistant (Build · claude-opus-4-6 · 5.2s)

That's the full analysis. The three real differentiators -- phone-as-approval-key, warm execution environment, cross-session state -- are things that are structurally impossible to replicate by spawning raw CLIs. Everything else I said in the first pass was padding. These three are the actual moat.

---

