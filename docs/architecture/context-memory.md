# Broski Context Memory — Architecture

> Cross-agent session memory so users never re-explain themselves.
> Combines best of OneContext (session recording + turn detection) and Claudis/OpenClaw (vector embeddings + hybrid search).

## The Problem

User finishes a session in Claude Code → opens new session (same agent or different agent) → agent has zero context → user has to re-explain everything.

## The Solution

The bridge already sees **every message** for all 3 agents. We capture, summarize, embed, and retrieve — so any new session can start with full context from past sessions.

## Why Broski Has an Unfair Advantage

| Tool | How they capture | Limitation |
|------|-----------------|------------|
| OneContext | File watcher + hooks on `~/.claude/projects/` | Passive, can miss turns, needs hook installation |
| Claudis | File watcher + chokidar on transcript files | Only sees their own sessions |
| **Broski** | **Wire-level interception — all traffic flows through bridge** | None — we ARE the relay |

We don't need file watchers. We don't need hooks. Every user message, every assistant response, every tool call, every permission prompt — it's already passing through `server.ts`. We just need to **tap the wire**.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        BRIDGE (TypeScript)                       │
│                                                                   │
│  ┌─────────┐    ┌──────────┐    ┌──────────┐    ┌────────────┐ │
│  │ Capture  │───▶│ Process  │───▶│  Store   │───▶│  Retrieve  │ │
│  │ (Tap)    │    │ (Summary │    │ (SQLite  │    │  (Hybrid   │ │
│  │          │    │  +Embed) │    │  +Vec)   │    │   Search)  │ │
│  └─────────┘    └──────────┘    └──────────┘    └────────────┘ │
│       │                                               │         │
│       │ cc_stream / cx_stream / oc_stream              │         │
│       │ (already flowing)                              │         │
│       ▼                                               ▼         │
│  ┌─────────┐                                   ┌────────────┐  │
│  │ All 3   │                                   │  Inject    │  │
│  │ Agents  │                                   │  Context   │  │
│  └─────────┘                                   └────────────┘  │
│                                                       │         │
└───────────────────────────────────────────────────────│─────────┘
                                                        │
                                                        ▼
                                                 ┌────────────┐
                                                 │ Flutter App │
                                                 │ (Browse,    │
                                                 │  Select,    │
                                                 │  Continue)  │
                                                 └────────────┘
```

---

## Full System Flow (Detailed)

```
╔══════════════════════════════════════════════════════════════════════════════════════╗
║                          BROSKI CONTEXT MEMORY — FULL FLOW                          ║
╚══════════════════════════════════════════════════════════════════════════════════════╝

  USER ON PHONE                         BRIDGE (on dev machine)                    AI AGENTS
  ─────────────                         ──────────────────────                    ──────────

  ┌─────────────┐     WebSocket      ┌──────────────────────────────────────────────────┐
  │  Broski App  │◀═══════════════▶  │                   server.ts                      │
  │  (Flutter)   │                   │                                                  │
  └──────┬───────┘                   │   Every message passes through here.             │
         │                           │   This is where we tap.                          │
         │                           └────────────┬──────────────┬──────────────────────┘
         │                                        │              │
         │                                        ▼              ▼
         │                           ┌────────────────┐  ┌───────────────┐  ┌──────────┐
         │                           │  Claude Code   │  │    Codex      │  │ OpenCode │
         │                           │  (Agent SDK)   │  │  (JSON-RPC)   │  │  (SDK)   │
         │                           └────────┬───────┘  └───────┬───────┘  └────┬─────┘
         │                                    │                  │               │
         │                              cc_stream           cx_stream       oc_stream
         │                                    │                  │               │
         │                                    ▼                  ▼               ▼
         │                           ┌────────────────────────────────────────────────┐
         │                           │                                                │
         │                           │            ★ LAYER 1: CAPTURE ★                │
         │                           │            (Wire Tap — Zero Cost)               │
         │                           │                                                │
         │                           │  observe(agent, sessionId, streamMessage)       │
         │                           │                                                │
         │                           │  ┌─────────────────────────────────────┐       │
         │                           │  │ TurnBuilder accumulates:            │       │
         │                           │  │  • User message (from chat cmd)     │       │
         │                           │  │  • Assistant text (deltas)          │       │
         │                           │  │  • Thinking (deltas)                │       │
         │                           │  │  • Tool calls (file edits, bash)    │       │
         │                           │  │  • Tool results                     │       │
         │                           │  │  • Token usage                      │       │
         │                           │  └─────────────────────────────────────┘       │
         │                           │                    │                            │
         │                           │   Turn complete?   │                            │
         │                           │   CC: result + stop_reason                      │
         │                           │   CX: completed notification                    │
         │                           │   OC: result event                              │
         │                           │                    │                            │
         │                           │                    ▼ YES                        │
         │                           │            emit('turn:complete')                │
         │                           └────────────────────┬───────────────────────────┘
         │                                                │
         │                                                ▼
         │                           ┌────────────────────────────────────────────────┐
         │                           │                                                │
         │                           │           ★ LAYER 2: PROCESS ★                 │
         │                           │         (Background, Non-Blocking)              │
         │                           │                                                │
         │                           │  ┌──────────┐  ┌───────────┐  ┌────────────┐  │
         │                           │  │ 2a.      │  │ 2b.       │  │ 2c.        │  │
         │                           │  │ EXTRACT  │─▶│ SUMMARIZE │─▶│ EMBED      │  │
         │                           │  │          │  │           │  │            │  │
         │                           │  │ Clean    │  │ Fast mode │  │ Provider   │  │
         │                           │  │ noise,   │  │ (instant, │  │ chain:     │  │
         │                           │  │ strip    │  │ no LLM)   │  │            │  │
         │                           │  │ IDE tags,│  │     +     │  │ ┌────────┐ │  │
         │                           │  │ classify │  │ LLM mode  │  │ │Ollama  │ │  │
         │                           │  │ tool     │  │ (better,  │  │ │(local) │ │  │
         │                           │  │ calls    │  │ optional) │  │ └───┬────┘ │  │
         │                           │  └──────────┘  └───────────┘  │     │ fail │  │
         │                           │                               │     ▼      │  │
         │                           │  Fast summary output:         │ ┌────────┐ │  │
         │                           │  ┌───────────────────────┐    │ │OpenAI  │ │  │
         │                           │  │ title: "Fix auth +    │    │ │embed   │ │  │
         │                           │  │   add rate limiting"  │    │ └───┬────┘ │  │
         │                           │  │ files: [middleware.ts, │    │     │ fail │  │
         │                           │  │   rate-limit.ts]      │    │     ▼      │  │
         │                           │  │ decisions:            │    │ ┌────────┐ │  │
         │                           │  │  - "Use sliding       │    │ │Gemini  │ │  │
         │                           │  │    window for rate    │    │ │embed   │ │  │
         │                           │  │    limits"            │    │ └───┬────┘ │  │
         │                           │  │  - "JWT validation    │    │     │ fail │  │
         │                           │  │    in middleware"      │    │     ▼      │  │
         │                           │  └───────────────────────┘    │ ┌────────┐ │  │
         │                           │                               │ │Voyage  │ │  │
         │                           │                               │ │embed   │ │  │
         │                           │                               │ └───┬────┘ │  │
         │                           │                               │     │ fail │  │
         │                           │                               │     ▼      │  │
         │                           │                               │  null      │  │
         │                           │                               │  (FTS only)│  │
         │                           │                               └────────────┘  │
         │                           └────────────────────┬───────────────────────────┘
         │                                                │
         │                                                ▼
         │                           ┌────────────────────────────────────────────────┐
         │                           │                                                │
         │                           │            ★ LAYER 3: STORE ★                  │
         │                           │          ~/.broski/memory.db                    │
         │                           │                                                │
         │                           │  ┌──────────────────────────────────────────┐  │
         │                           │  │              SQLite Database              │  │
         │                           │  │                                          │  │
         │                           │  │  sessions ──┐                            │  │
         │                           │  │  (id, agent,│    turns ──┐               │  │
         │                           │  │   project,  │    (id,    │  chunks ──┐   │  │
         │                           │  │   title,    ├───▶session,│  (id,     │   │  │
         │                           │  │   summary)  │    user_msg├─▶turn_id, │   │  │
         │                           │  │             │    asst_sum,│  text,    │   │  │
         │                           │  │             │    title,  │  embedding)│   │  │
         │                           │  │             │    files)  │            │   │  │
         │                           │  │             │            │            │   │  │
         │                           │  │  ┌──────────┴────────────┴────────────┘   │  │
         │                           │  │  │                                        │  │
         │                           │  │  │  ┌─────────────┐  ┌────────────────┐   │  │
         │                           │  │  │  │ chunks_vec  │  │  chunks_fts    │   │  │
         │                           │  │  │  │ (sqlite-vec)│  │  (FTS5)        │   │  │
         │                           │  │  │  │             │  │                │   │  │
         │                           │  │  │  │ Vector      │  │  Keyword       │   │  │
         │                           │  │  │  │ similarity  │  │  search        │   │  │
         │                           │  │  │  │ search      │  │  (always works)│   │  │
         │                           │  │  │  │ (needs      │  │                │   │  │
         │                           │  │  │  │ embeddings) │  │                │   │  │
         │                           │  │  │  └─────────────┘  └────────────────┘   │  │
         │                           │  │  │                                        │  │
         │                           │  │  │  ┌──────────────────┐                  │  │
         │                           │  │  │  │ embedding_cache  │                  │  │
         │                           │  │  │  │ (provider+model  │                  │  │
         │                           │  │  │  │  +hash → vector) │                  │  │
         │                           │  │  │  │ Skip re-embed    │                  │  │
         │                           │  │  │  │ unchanged content│                  │  │
         │                           │  │  │  └──────────────────┘                  │  │
         │                           │  │  │                                        │  │
         │                           │  └──┴────────────────────────────────────────┘  │
         │                           └────────────────────────────────────────────────┘
         │
         │
         │  ════════════════════════════════════════════════════════════════════════
         │  NOW THE MAGIC PART: USER STARTS A NEW SESSION
         │  ════════════════════════════════════════════════════════════════════════
         │
         │  User types a message in Broski app...
         │
         ▼
  ┌─────────────┐
  │ User types:  │
  │              │
  │ "based on    │──────────────────────────────────────────────────────────┐
  │  last session│                                                          │
  │  fix the     │                                                          │
  │  remaining   │                                                          ▼
  │  auth bugs"  │              ┌────────────────────────────────────────────────┐
  │              │              │                                                │
  └──────────────┘              │       ★ LAYER 4: RETRIEVE ★                   │
                                │       (Hybrid Search)                         │
                                │                                                │
                                │  Step 1: Detect intent                        │
                                │  ┌──────────────────────────────────────┐     │
                                │  │ KEYWORD TRIGGERS:                    │     │
                                │  │                                      │     │
                                │  │ "based on last session"     → AUTO   │     │
                                │  │ "continue from..."          → AUTO   │     │
                                │  │ "like we discussed"         → AUTO   │     │
                                │  │ "remember when..."          → AUTO   │     │
                                │  │ "in the previous session"   → AUTO   │     │
                                │  │ "pick up where we left off" → AUTO   │     │
                                │  │ "as before"                 → AUTO   │     │
                                │  │                                      │     │
                                │  │ OR: User tapped "Continue from..."   │     │
                                │  │ button in the app UI                 │     │
                                │  │                                      │     │
                                │  │ OR: Auto-context is ON (default)     │     │
                                │  │ and this is the FIRST message in     │     │
                                │  │ a new session                        │     │
                                │  └──────────────────────────────────────┘     │
                                │                                                │
                                │  Step 2: Search past context                  │
                                │  ┌──────────────────────────────────────┐     │
                                │  │                                      │     │
                                │  │  Query: "auth bugs" (from user msg)  │     │
                                │  │  Scope: same project_path            │     │
                                │  │  Across: all agents                  │     │
                                │  │                                      │     │
                                │  │         ┌──────────┐                 │     │
                                │  │         │  HYBRID  │                 │     │
                                │  │    ┌───▶│  MERGE   │◀───┐           │     │
                                │  │    │    └────┬─────┘    │           │     │
                                │  │    │         │          │           │     │
                                │  │  ┌─┴───┐    │    ┌─────┴──┐       │     │
                                │  │  │Vec  │    │    │ FTS5   │       │     │
                                │  │  │Score│    │    │ Score  │       │     │
                                │  │  │×0.7 │    │    │ ×0.3   │       │     │
                                │  │  └─────┘    │    └────────┘       │     │
                                │  │             │                      │     │
                                │  │         ┌───▼───┐                  │     │
                                │  │         │ RANK  │                  │     │
                                │  │         │ top N │                  │     │
                                │  │         └───┬───┘                  │     │
                                │  │             │                      │     │
                                │  │             ▼                      │     │
                                │  │  Results:                         │     │
                                │  │  1. [CC] "Fix JWT validation"     │     │
                                │  │     score: 0.89                   │     │
                                │  │  2. [CX] "Add rate limiter"       │     │
                                │  │     score: 0.76                   │     │
                                │  │  3. [CC] "Refactor auth middleware│     │
                                │  │     score: 0.71                   │     │
                                │  └──────────────────────────────────────┘     │
                                └────────────────────┬───────────────────────────┘
                                                     │
                                                     ▼
                                ┌────────────────────────────────────────────────┐
                                │                                                │
                                │        ★ LAYER 5: INJECT ★                    │
                                │        (Context → Agent Prompt)                │
                                │                                                │
                                │  Build context block:                         │
                                │  ┌──────────────────────────────────────┐     │
                                │  │                                      │     │
                                │  │  ## Previous Session Context          │     │
                                │  │                                      │     │
                                │  │  Recent work on this project:        │     │
                                │  │                                      │     │
                                │  │  ### [Claude Code] Fix JWT validation│     │
                                │  │  Fixed JWT token validation in auth  │     │
                                │  │  middleware. Added expiry check and  │     │
                                │  │  refresh token rotation.             │     │
                                │  │  Files: src/middleware/auth.ts,      │     │
                                │  │    src/utils/jwt.ts                  │     │
                                │  │  Decision: Use RS256 over HS256     │     │
                                │  │                                      │     │
                                │  │  ### [Codex] Add rate limiter        │     │
                                │  │  Implemented sliding window rate     │     │
                                │  │  limiter. 100 req/min per user.     │     │
                                │  │  Files: src/middleware/rate-limit.ts │     │
                                │  │  Decision: Redis-backed for cluster │     │
                                │  │                                      │     │
                                │  │  (token budget: ~2000 tokens max)   │     │
                                │  └──────────────────────────────────────┘     │
                                │                                                │
                                │  Injection method per agent:                  │
                                │  ┌──────────────────────────────────────┐     │
                                │  │                                      │     │
                                │  │  Claude Code:                        │     │
                                │  │    SDK chat() → system param         │     │
                                │  │    OR prepend to user message        │     │
                                │  │    OR write to .claude/MEMORY.md     │     │
                                │  │                                      │     │
                                │  │  Codex:                              │     │
                                │  │    Prepend to user message content   │     │
                                │  │    OR write to AGENTS.md             │     │
                                │  │                                      │     │
                                │  │  OpenCode:                           │     │
                                │  │    Prepend to user message content   │     │
                                │  │    OR write to .opencode/MEMORY.md   │     │
                                │  │                                      │     │
                                │  └──────────────────────────────────────┘     │
                                │                                                │
                                └────────────────────┬───────────────────────────┘
                                                     │
                                                     ▼
                                     ┌───────────────────────────────┐
                                     │  WHAT THE AGENT ACTUALLY SEES │
                                     │                               │
                                     │  [System/Context]:            │
                                     │  ## Previous Session Context  │
                                     │  ... (injected summaries)     │
                                     │                               │
                                     │  [User Message]:              │
                                     │  "fix the remaining auth bugs"│
                                     │                               │
                                     │  The agent now KNOWS what     │
                                     │  happened before. It can say: │
                                     │  "I see from the previous     │
                                     │  sessions you fixed JWT       │
                                     │  validation and added rate    │
                                     │  limiting. Let me check what  │
                                     │  auth bugs remain..."         │
                                     └───────────────────────────────┘
```

---

## Degradation Chain (Every Tier Works)

```
╔══════════════════════════════════════════════════════════════════════════════════════╗
║                                                                                      ║
║   Has Ollama + sqlite-vec?                                                           ║
║   ┌─────────────────────────────────────────────────────┐                            ║
║   │ FULL POWER: Hybrid search (vector 0.7 + FTS 0.3)   │ ← Best quality             ║
║   │ Semantic: "database schema decisions" finds turns   │                            ║
║   │ about "chose PostgreSQL over MongoDB"               │                            ║
║   └─────────────────────────────────────────────────────┘                            ║
║                          │ no local model?                                           ║
║                          ▼                                                           ║
║   Has OpenAI/Gemini key + sqlite-vec?                                                ║
║   ┌─────────────────────────────────────────────────────┐                            ║
║   │ CLOUD HYBRID: Same quality, API calls for embedding │ ← Costs $ per embed        ║
║   │ Cached: only new turns cost money                   │                            ║
║   └─────────────────────────────────────────────────────┘                            ║
║                          │ no API keys?                                              ║
║                          ▼                                                           ║
║   Has FTS5 (built into SQLite)?                                                      ║
║   ┌─────────────────────────────────────────────────────┐                            ║
║   │ KEYWORD ONLY: BM25 full-text search                 │ ← Free, instant, good      ║
║   │ "auth middleware" finds turns mentioning those words │   enough for most cases     ║
║   └─────────────────────────────────────────────────────┘                            ║
║                          │ search not needed?                                        ║
║                          ▼                                                           ║
║   Just the database exists?                                                          ║
║   ┌─────────────────────────────────────────────────────┐                            ║
║   │ RECENCY: Last N turns from same project             │ ← Zero config, still       ║
║   │ "Here's what happened in your last 5 turns"         │   better than nothing       ║
║   └─────────────────────────────────────────────────────┘                            ║
║                                                                                      ║
╚══════════════════════════════════════════════════════════════════════════════════════╝
```

---

## Context Trigger Detection (When to Inject)

```
╔══════════════════════════════════════════════════════════════════════════════════════╗
║                                                                                      ║
║  User message arrives at bridge. Before forwarding to agent:                         ║
║                                                                                      ║
║  ┌─────────────────────────────────────────────────────────────────────────────┐     ║
║  │                        CONTEXT TRIGGER ENGINE                               │     ║
║  │                                                                             │     ║
║  │  CHECK 1: Is this the FIRST message in a new session?                       │     ║
║  │           AND auto-context is enabled?                                      │     ║
║  │           → YES: inject last session's context (lightweight summary)        │     ║
║  │                                                                             │     ║
║  │  CHECK 2: Does the message contain EXPLICIT trigger phrases?                │     ║
║  │           Regex patterns:                                                   │     ║
║  │                                                                             │     ║
║  │           /based on (last|previous|earlier) session/i                       │     ║
║  │           /continue (from |where )(we |I )?(left off|stopped|were)/i        │     ║
║  │           /pick up where/i                                                  │     ║
║  │           /(remember|recall) (when|what|how) (we|I)/i                       │     ║
║  │           /in (the |my )?(last|previous|earlier) (session|conversation)/i   │     ║
║  │           /like (we|I) (discussed|decided|did|built|fixed)/i                │     ║
║  │           /as (we|I) (discussed|decided|planned)/i                          │     ║
║  │           /following up on/i                                                │     ║
║  │           /to recap/i                                                       │     ║
║  │                                                                             │     ║
║  │           → YES: deep context search using message content as query         │     ║
║  │                  inject RELEVANT turns (not just recent ones)               │     ║
║  │                                                                             │     ║
║  │  CHECK 3: Does the message reference specific past work?                    │     ║
║  │           Heuristic: mentions files that were changed in past turns         │     ║
║  │           e.g. "fix the bug in auth.ts" → we have turns touching auth.ts   │     ║
║  │           → YES: inject context from turns that touched those files         │     ║
║  │                                                                             │     ║
║  │  CHECK 4: None of the above?                                               │     ║
║  │           → NO INJECTION (don't waste tokens on unrelated messages)         │     ║
║  │                                                                             │     ║
║  │  TOKEN BUDGET:                                                              │     ║
║  │  • Auto-context (Check 1):        ~1000 tokens (light summary)             │     ║
║  │  • Explicit trigger (Check 2):    ~2000 tokens (deeper context)            │     ║
║  │  • File reference (Check 3):      ~1500 tokens (targeted context)          │     ║
║  │  • User can configure max tokens in settings                               │     ║
║  │                                                                             │     ║
║  └─────────────────────────────────────────────────────────────────────────────┘     ║
║                                                                                      ║
║  INJECTION FORMAT (what gets prepended):                                             ║
║                                                                                      ║
║  ┌─────────────────────────────────────────────────────────────────────────────┐     ║
║  │                                                                             │     ║
║  │  <context source="broski-memory" tokens="~1200">                           │     ║
║  │                                                                             │     ║
║  │  ## Previous Session Context                                                │     ║
║  │                                                                             │     ║
║  │  ### [Claude Code] 2h ago — Fix JWT validation in auth middleware           │     ║
║  │  - Fixed token expiry check (was comparing wrong timestamp field)           │     ║
║  │  - Added refresh token rotation on each request                             │     ║
║  │  - Decision: RS256 signing (asymmetric) over HS256 (symmetric)             │     ║
║  │  - Files: src/middleware/auth.ts, src/utils/jwt.ts                          │     ║
║  │                                                                             │     ║
║  │  ### [Codex] 45min ago — Add sliding window rate limiter                    │     ║
║  │  - Implemented per-user rate limiting: 100 req/min                          │     ║
║  │  - Redis-backed counter for multi-instance deployments                      │     ║
║  │  - Files: src/middleware/rate-limit.ts, src/config/limits.ts                │     ║
║  │                                                                             │     ║
║  │  </context>                                                                 │     ║
║  │                                                                             │     ║
║  │  --- (then the actual user message follows) ---                             │     ║
║  │                                                                             │     ║
║  │  fix the remaining auth bugs                                                │     ║
║  │                                                                             │     ║
║  └─────────────────────────────────────────────────────────────────────────────┘     ║
║                                                                                      ║
╚══════════════════════════════════════════════════════════════════════════════════════╝
```

---

## Flutter App — User Controls

```
╔══════════════════════════════════════════════════════════════════════════════════════╗
║                                                                                      ║
║  ┌──────────────────────────────────────────────┐                                    ║
║  │  Chat Screen (existing)                      │                                    ║
║  │  ┌────────────────────────────────────────┐  │                                    ║
║  │  │  🧠 Context: 2 sessions loaded (1.2k)  │  │  ← Subtle indicator               ║
║  │  │     Tap to view/edit                    │  │     Shows when context is active   ║
║  │  └────────────────────────────────────────┘  │                                    ║
║  │                                              │                                    ║
║  │  ┌────────────────────────────────────────┐  │                                    ║
║  │  │  [Message input field]                 │  │                                    ║
║  │  │                                 [Send] │  │                                    ║
║  │  └────────────────────────────────────────┘  │                                    ║
║  │                                              │                                    ║
║  │  Long-press Send → "Send with context..."    │                                    ║
║  │                                              │                                    ║
║  └──────────────────────────────────────────────┘                                    ║
║                                                                                      ║
║  ┌──────────────────────────────────────────────┐                                    ║
║  │  Session History Sheet (NEW)                  │                                    ║
║  │                                              │                                    ║
║  │  📋 Session Memory                           │                                    ║
║  │                                              │                                    ║
║  │  Today                                       │                                    ║
║  │  ├─ 🟣 [CC] Fix JWT validation    2h ago    │                                    ║
║  │  │      3 turns · auth.ts, jwt.ts            │                                    ║
║  │  ├─ 🟢 [CX] Add rate limiter     45m ago    │                                    ║
║  │  │      2 turns · rate-limit.ts              │                                    ║
║  │  └─ 🔵 [OC] Update API docs      20m ago    │                                    ║
║  │         1 turn · README.md                   │                                    ║
║  │                                              │                                    ║
║  │  Yesterday                                   │                                    ║
║  │  ├─ 🟣 [CC] Set up project        ...       │                                    ║
║  │  └─ 🟢 [CX] Database migrations   ...       │                                    ║
║  │                                              │                                    ║
║  │  [🔍 Search past sessions...]                │                                    ║
║  │                                              │                                    ║
║  │  Tap session → see turns                     │                                    ║
║  │  "Continue from this" button on each         │                                    ║
║  │                                              │                                    ║
║  └──────────────────────────────────────────────┘                                    ║
║                                                                                      ║
╚══════════════════════════════════════════════════════════════════════════════════════╝
```

---

## Layer 1: Capture (Wire Tap)

**File:** `packages/bridge/src/memory/capture.ts`

### What We Capture

We already have stream messages flowing through the bridge for all 3 agents:

| Agent | Stream Type | User Message | Assistant Response | Tool Calls | Turn Complete Signal |
|-------|------------|-------------|-------------------|------------|---------------------|
| Claude Code | `cc_stream` | `chat` message | `assistant-message` | `tool-call` + `tool-result` | `result` event (stop_reason) |
| Codex | `cx_stream` | `cx_chat` message | `notification` (response items) | `notification` (function_call) | `completed` notification |
| OpenCode | `oc_stream` | `oc_chat` message | `assistant-message` | `tool-call` | `result` event |

### The Tap

A lightweight interceptor in `server.ts` that observes stream messages without modifying them:

```typescript
// memory/capture.ts
export class TurnCapture {
  private activeTurns: Map<string, TurnBuilder> = new Map()

  // Called from server.ts for every outgoing stream message
  observe(agent: AgentType, sessionId: string, message: StreamMessage): void {
    const key = `${agent}:${sessionId}`
    let turn = this.activeTurns.get(key)

    if (isUserMessage(agent, message)) {
      // New turn starting
      turn = new TurnBuilder(agent, sessionId, message)
      this.activeTurns.set(key, turn)
    } else if (turn) {
      turn.append(message)

      if (isTurnComplete(agent, message)) {
        this.activeTurns.delete(key)
        this.emit('turn:complete', turn.build())
      }
    }
  }
}
```

### Turn Complete Detection

Adapted from OneContext's hook approach, but at the wire level:

| Agent | Turn Complete When |
|-------|-------------------|
| Claude Code | `cc_stream` has `type: 'result'` with `stop_reason` (end_turn / max_tokens) |
| Codex | `cx_stream` has `type: 'completed'` or `notification` with `conversation.completed` |
| OpenCode | `oc_stream` has `type: 'result'` |

### Raw Turn Data

```typescript
type RawTurn = {
  id: string                    // UUID
  agent: 'claude-code' | 'codex' | 'opencode'
  sessionId: string             // Agent's session ID
  projectPath: string           // cwd / workspace
  turnNumber: number            // Sequential within session
  userMessage: string           // What the user asked
  assistantResponse: string     // Full assistant text (thinking + response)
  toolCalls: ToolCallSummary[]  // What tools were used (file edits, commands, etc.)
  filesChanged: string[]        // Paths of files touched
  model: string                 // Which model was used
  startedAt: number             // Timestamp
  completedAt: number           // Timestamp
  stopReason: string            // end_turn, max_tokens, user_abort, etc.
  tokenUsage?: { input: number; output: number }
}
```

**Zero overhead rule:** Capture is synchronous observation only. No async work, no DB writes, no LLM calls in the hot path. Just buffer the turn data and emit when complete.

---

## Layer 2: Processing (Summarize + Embed)

**Files:**
- `packages/bridge/src/memory/processor.ts` — orchestrator
- `packages/bridge/src/memory/summarizer.ts` — LLM summarization
- `packages/bridge/src/memory/embedder.ts` — embedding provider chain

### Processing Pipeline

Runs async in background after `turn:complete` fires:

```
RawTurn → Extract → Summarize → Embed → Store
```

### 2a: Extract

From OneContext's `filter_session_content()` pattern — strip noise, keep signal:

```typescript
// memory/extract.ts
export function extractTurnContent(turn: RawTurn): ExtractedTurn {
  return {
    ...turn,
    // Clean user message (remove IDE context tags, system noise)
    userMessage: cleanUserMessage(turn.userMessage),
    // Extract key decisions from assistant response
    assistantSummary: extractAssistantKey(turn.assistantResponse),
    // Classify tool calls: edits vs reads vs commands
    edits: turn.toolCalls.filter(t => t.tool === 'Edit' || t.tool === 'Write'),
    commands: turn.toolCalls.filter(t => t.tool === 'Bash' || t.tool === 'shell'),
    // Skip: Read, Glob, Grep (exploratory, not actionable)
  }
}
```

### 2b: Summarize

Two modes, adapting from both projects:

**Fast mode (no LLM, instant):**
Extractive summary from the turn data itself. Always runs first.

```typescript
function fastSummarize(turn: ExtractedTurn): TurnSummary {
  return {
    title: buildTitle(turn),        // "Fix auth middleware + add rate limiting"
    description: buildDescription(turn), // Bullet points of what changed
    filesChanged: turn.filesChanged,
    decisions: extractDecisions(turn.assistantSummary), // Key choices made
  }
}
```

**Deep mode (LLM, background):**
If the user has configured an API key (OpenAI/Anthropic/Gemini), enhance with LLM summary. Replaces `title` and `description` with better ones.

From OneContext's cloud approach, but local-first:
1. Try local model if available (Ollama, llama.cpp)
2. Fall back to configured cloud API
3. If nothing available, fast mode is fine — it's still useful

### 2c: Embed

From Claudis's embedding chain — the best part of their architecture:

```typescript
// memory/embedder.ts
export class EmbeddingChain {
  private providers: EmbeddingProvider[]

  constructor(config: MemoryConfig) {
    this.providers = []

    // Priority 1: Local embeddings (no API key needed, fast, private)
    if (config.local?.enabled !== false) {
      this.providers.push(new OllamaEmbedder(config.local))
      // Falls back to: node-llama if Ollama not available
    }

    // Priority 2: Configured cloud provider
    if (config.openai?.apiKey) {
      this.providers.push(new OpenAIEmbedder(config.openai))
    }
    if (config.gemini?.apiKey) {
      this.providers.push(new GeminiEmbedder(config.gemini))
    }
    if (config.voyage?.apiKey) {
      this.providers.push(new VoyageEmbedder(config.voyage))
    }

    // Priority 3: No embeddings — FTS-only mode still works
  }

  async embed(text: string): Promise<number[] | null> {
    for (const provider of this.providers) {
      try {
        return await provider.embed(text)
      } catch (err) {
        log.warn(`Embedding provider ${provider.id} failed, trying next: ${err}`)
        continue
      }
    }
    return null // FTS-only fallback
  }
}
```

**Chunking** (from Claudis):
- Turn summaries are short → embed as single chunk
- Full assistant responses → chunk with 512 token windows, 64 token overlap
- Memory files (MEMORY.md, CLAUDE.md) → chunk markdown by section

**Embedding Cache** (from Claudis):
- Cache by `contentHash + provider + model` in SQLite
- Re-embed only when content changes
- Survives bridge restarts

---

## Layer 3: Store (SQLite + Vec)

**File:** `packages/bridge/src/memory/store.ts`

### Database: `~/.broski/memory.db`

Single SQLite database. From Claudis: use `sqlite-vec` for vector search, `FTS5` for keyword search. From OneContext: the relational data model for sessions → turns → contexts.

```sql
-- Sessions across all agents
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,           -- broski-generated UUID
  agent TEXT NOT NULL,           -- 'claude-code' | 'codex' | 'opencode'
  agent_session_id TEXT,         -- agent's own session ID (for linking back)
  project_path TEXT,             -- workspace/cwd
  title TEXT,                    -- LLM or extractive title
  summary TEXT,                  -- Rolling session summary
  model TEXT,                    -- Primary model used
  started_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  total_turns INTEGER DEFAULT 0,
  metadata TEXT                  -- JSON (tags, custom fields)
);

CREATE INDEX idx_sessions_project ON sessions(project_path);
CREATE INDEX idx_sessions_agent ON sessions(agent);
CREATE INDEX idx_sessions_activity ON sessions(last_activity_at DESC);

-- Individual turns within sessions
CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_number INTEGER NOT NULL,
  user_message TEXT,             -- What the user asked
  assistant_summary TEXT,        -- Processed summary of response
  title TEXT,                    -- One-line turn title
  files_changed TEXT,            -- JSON array of file paths
  decisions TEXT,                -- JSON array of key decisions
  model TEXT,
  stop_reason TEXT,
  token_usage TEXT,              -- JSON { input, output }
  content_hash TEXT NOT NULL,    -- For dedup
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  UNIQUE(session_id, turn_number)
);

CREATE INDEX idx_turns_session ON turns(session_id);
CREATE INDEX idx_turns_time ON turns(completed_at DESC);

-- Chunks for vector + FTS search
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  source TEXT NOT NULL,          -- 'turn_summary' | 'assistant_full' | 'memory_file'
  text TEXT NOT NULL,
  embedding TEXT,                -- JSON float array (for portability)
  content_hash TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  model TEXT,                    -- embedding model used
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_chunks_session ON chunks(session_id);
CREATE INDEX idx_chunks_source ON chunks(source);

-- Vector search (sqlite-vec)
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[768]          -- dimensions depend on provider
);

-- Full-text search (FTS5) — works without embeddings
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  id UNINDEXED,
  session_id UNINDEXED,
  source UNINDEXED
);

-- Embedding cache (from Claudis — avoid re-embedding unchanged content)
CREATE TABLE embedding_cache (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding TEXT NOT NULL,
  dims INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, model, content_hash)
);

-- Named contexts (from OneContext — group sessions for loading)
CREATE TABLE contexts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_path TEXT,             -- Scoped to project or global
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- M2M: which sessions belong to which context
CREATE TABLE context_sessions (
  context_id TEXT NOT NULL REFERENCES contexts(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (context_id, session_id)
);

-- Memory files (MEMORY.md, CLAUDE.md, etc.) — from Claudis
CREATE TABLE memory_files (
  path TEXT PRIMARY KEY,
  project_path TEXT,
  content_hash TEXT NOT NULL,
  last_indexed_at INTEGER,
  size INTEGER
);
```

### Why SQLite + Vec (not external DB)

- **Zero setup.** User installs Broski, memory works immediately.
- **Portable.** Single file, backs up with the machine.
- **Fast enough.** Claudis proves hybrid SQLite search works for personal-scale data (thousands of turns, not millions).
- **sqlite-vec** is a single C extension, ~200KB. Already proven in Claudis's production.
- **FTS5** is built into SQLite. Always available, no dependencies.

---

## Layer 4: Retrieve (Hybrid Search)

**File:** `packages/bridge/src/memory/retriever.ts`

### Hybrid Search (from Claudis)

Combine vector similarity + BM25 keyword search:

```typescript
// memory/retriever.ts
export class ContextRetriever {
  async search(query: string, opts: SearchOpts): Promise<SearchResult[]> {
    const vectorResults = await this.vectorSearch(query, opts)
    const keywordResults = await this.keywordSearch(query, opts)

    // Merge with configurable weights (default: 0.7 vector, 0.3 keyword)
    return mergeHybridResults({
      vector: vectorResults,
      keyword: keywordResults,
      vectorWeight: opts.vectorWeight ?? 0.7,
      textWeight: opts.textWeight ?? 0.3,
    })
  }

  // Scoping options
  async searchForProject(projectPath: string, query: string): Promise<SearchResult[]>
  async searchForAgent(agent: AgentType, query: string): Promise<SearchResult[]>
  async searchRecent(limit: number): Promise<SearchResult[]>
  async searchCrossAgent(projectPath: string, query: string): Promise<SearchResult[]>
}
```

### Degradation Chain

```
Has sqlite-vec + embeddings?  → Full hybrid search (vector + FTS)
Has embeddings but no vec?    → Approximate search via embedding cosine in JS + FTS
Has FTS only?                 → Keyword search only (still useful!)
Nothing?                      → Recency-based retrieval (last N turns from same project)
```

**Every tier is useful.** Even without any embeddings, "show me the last 5 turns from this project" is better than starting from zero.

---

## Layer 5: Inject (Context Loading)

**File:** `packages/bridge/src/memory/injector.ts`

### How Context Gets Into New Sessions

Three modes, from most automatic to most manual:

### Mode 1: Auto-Context (Default)

When the bridge starts a new session for any agent, it automatically prepends context:

```typescript
// memory/injector.ts
export async function buildAutoContext(
  projectPath: string,
  agent: AgentType,
  opts?: { maxTokens?: number }
): Promise<string | null> {
  const retriever = getRetriever()
  const maxTokens = opts?.maxTokens ?? 2000

  // Get recent turns from same project (any agent)
  const recentTurns = await retriever.searchRecent({
    projectPath,
    limit: 10,
    excludeAgent: agent, // Don't include current agent's own context (it has its own)
  })

  if (recentTurns.length === 0) return null

  // Build context block
  return formatContextBlock(recentTurns, { maxTokens })
}

function formatContextBlock(turns: Turn[], opts: { maxTokens: number }): string {
  let context = `## Previous Session Context\n\n`
  context += `The following is a summary of recent work on this project:\n\n`

  for (const turn of turns) {
    context += `### [${turn.agent}] ${turn.title}\n`
    context += `${turn.summary}\n`
    if (turn.filesChanged.length > 0) {
      context += `Files: ${turn.filesChanged.join(', ')}\n`
    }
    context += `\n`
    if (estimateTokens(context) > opts.maxTokens) break
  }

  return context
}
```

### Mode 2: "Based on last session" (User Trigger)

User types "based on last session" or taps "Continue" button in the app:

```typescript
case 'memory_load_context': {
  const context = await injector.buildContextForSession(
    message.sessionId,   // Which past session to load
    message.projectPath,
    { depth: message.depth ?? 'summary' } // 'summary' | 'full' | 'search'
  )
  // Prepend to next chat message as system context
  reply({ type: 'memory_context_loaded', data: context })
  break
}
```

### Mode 3: Semantic Search (User Query)

User searches for specific past context from the app:

```typescript
case 'memory_search': {
  const results = await retriever.search(message.query, {
    projectPath: message.projectPath,
    agent: message.agent,
    maxResults: message.limit ?? 10,
  })
  reply({ type: 'memory_search_results', data: results })
  break
}
```

### Context Injection Points

| Agent | How We Inject |
|-------|--------------|
| Claude Code | Prepend to user message via SDK `chat()` call. The SDK supports `system` parameter — use that for context. Or inject via CLAUDE.md (write context to project's CLAUDE.md before session starts). |
| Codex | Prepend to first user message. Codex reads `AGENTS.md` — we can also write there. |
| OpenCode | Prepend to user message via SDK `chat()` call. |

---

## Layer 6: Flutter App (Browse + Control)

### New Wire Messages

```typescript
// Client → Bridge
| { type: 'memory_search'; query: string; projectPath?: string; agent?: AgentType; limit?: number }
| { type: 'memory_list_sessions'; projectPath?: string; agent?: AgentType; limit?: number }
| { type: 'memory_get_session'; sessionId: string }
| { type: 'memory_get_turns'; sessionId: string; limit?: number }
| { type: 'memory_load_context'; sessionId?: string; projectPath?: string; depth?: 'summary' | 'full' }
| { type: 'memory_create_context'; name: string; sessionIds: string[]; projectPath?: string }
| { type: 'memory_config'; config: Partial<MemoryConfig> }
| { type: 'memory_status' }

// Bridge → Client
| { type: 'memory_search_results'; data: MemorySearchResult[]; requestId?: string }
| { type: 'memory_sessions'; data: MemorySession[]; requestId?: string }
| { type: 'memory_session'; data: MemorySession; requestId?: string }
| { type: 'memory_turns'; data: MemoryTurn[]; requestId?: string }
| { type: 'memory_context_loaded'; data: { context: string; turnCount: number; tokenEstimate: number }; requestId?: string }
| { type: 'memory_context_created'; data: MemoryContext; requestId?: string }
| { type: 'memory_config_updated'; data: MemoryConfig; requestId?: string }
| { type: 'memory_status'; data: MemoryStatus; requestId?: string }
```

### App UI

**Session History Screen** (`lib/screens/sheets/memory_sessions_sheet.dart`):
- List all past sessions grouped by project
- Shows agent icon + title + turn count + timestamp
- Tap to see turns, long-press to create named context

**Context Picker** (`lib/widgets/context_picker.dart`):
- Appears when starting new session
- "Continue from..." dropdown showing recent sessions
- "Search past context..." text field for semantic search
- Toggle: auto-context on/off

**Memory Status** (in settings):
- Embedding provider: local / openai / gemini / none
- Index stats: N sessions, N turns, N chunks
- Sync/reindex button
- Storage size

---

## Configuration

**File:** `packages/bridge/src/memory/config.ts`

```typescript
export type MemoryConfig = {
  enabled: boolean                    // Master switch (default: true)
  autoContext: boolean                // Auto-inject context on new sessions (default: true)
  autoContextMaxTokens: number        // Max tokens for auto-context (default: 2000)

  embeddings: {
    provider: 'auto' | 'local' | 'openai' | 'gemini' | 'voyage' | 'none'
    // 'auto' = try local first, then fall back to configured cloud
    // 'none' = FTS-only mode (still useful)
    local?: {
      enabled: boolean                // Default: true (try Ollama first)
      model?: string                  // Default: 'nomic-embed-text'
      ollamaUrl?: string              // Default: 'http://localhost:11434'
    }
    openai?: { apiKey?: string; model?: string }
    gemini?: { apiKey?: string; model?: string }
    voyage?: { apiKey?: string; model?: string }
  }

  summarization: {
    mode: 'fast' | 'llm' | 'auto'    // Default: 'auto' (fast first, llm if available)
    provider?: 'local' | 'openai' | 'anthropic' | 'gemini'
  }

  storage: {
    dbPath?: string                   // Default: '~/.broski/memory.db'
    maxSessions?: number              // Prune old sessions (default: 500)
    maxTurnsPerSession?: number       // Default: 200
  }

  search: {
    vectorWeight: number              // Default: 0.7
    textWeight: number                // Default: 0.3
    minScore: number                  // Default: 0.3
    maxResults: number                // Default: 10
  }
}
```

Stored in `~/.broski/config.json` alongside existing bridge config.

---

## File Structure

```
packages/bridge/src/memory/
├── index.ts                 # Public API: init(), getMemory()
├── capture.ts               # Layer 1: Wire tap, turn detection
├── extract.ts               # Layer 2a: Content extraction + cleaning
├── summarizer.ts            # Layer 2b: Fast + LLM summarization
├── embedder.ts              # Layer 2c: Embedding provider chain
├── store.ts                 # Layer 3: SQLite + Vec + FTS
├── schema.ts                # Layer 3: SQL schema + migrations
├── retriever.ts             # Layer 4: Hybrid search
├── injector.ts              # Layer 5: Context injection
├── config.ts                # Configuration types + defaults
├── types.ts                 # Shared types (RawTurn, MemorySession, etc.)
└── providers/
    ├── ollama.ts            # Local: Ollama embeddings
    ├── openai.ts            # Cloud: OpenAI embeddings
    ├── gemini.ts            # Cloud: Gemini embeddings
    ├── voyage.ts            # Cloud: Voyage embeddings
    └── base.ts              # EmbeddingProvider interface
```

```
lib/                         # Flutter
├── models/memory.dart       # MemorySession, MemoryTurn, MemorySearchResult
├── providers/memory_provider.dart
├── services/bridge_service.dart  # +memory methods
└── screens/sheets/
    ├── memory_sessions_sheet.dart
    ├── memory_turns_sheet.dart
    └── memory_search_sheet.dart
```

---

## Implementation Order

### Phase 1: Capture + Store (foundation, no AI needed)
1. `schema.ts` + `store.ts` — SQLite database with sessions + turns tables
2. `capture.ts` — Wire tap on cc_stream / cx_stream / oc_stream
3. `extract.ts` — Turn content extraction
4. Fast summarization (extractive, no LLM)
5. Wire messages: `memory_list_sessions`, `memory_get_turns`
6. Flutter: basic session history sheet

**Result:** User can see a history of all past sessions + turns. No AI, no embeddings, but already useful.

### Phase 2: FTS Search (keyword search, still no AI)
1. FTS5 indexing of turn summaries
2. `retriever.ts` — keyword search only
3. Wire message: `memory_search`
4. Flutter: search sheet

**Result:** User can search past sessions by keyword. "Find when I worked on auth" → results.

### Phase 3: Context Injection (the core value)
1. `injector.ts` — build context blocks from past turns
2. Auto-context on new session start
3. "Based on last session" / "Continue from..." flow
4. Wire messages: `memory_load_context`
5. Flutter: context picker widget

**Result:** "Based on last session" works. New sessions start with context. The killer feature.

### Phase 4: Embeddings + Hybrid Search (the upgrade)
1. `embedder.ts` — provider chain (Ollama → OpenAI → Gemini → Voyage)
2. sqlite-vec integration
3. Hybrid search (vector + FTS)
4. Embedding cache
5. Config UI in Flutter

**Result:** Semantic search. "What did we decide about the database schema?" finds relevant turns even if they don't contain those exact words.

### Phase 5: LLM Summarization (polish)
1. `summarizer.ts` — LLM mode for better summaries
2. Session-level rolling summaries
3. Named contexts (group sessions)
4. Memory files (index CLAUDE.md, AGENTS.md, MEMORY.md)

**Result:** Professional-quality summaries, named context groups, full Claudis-level memory system.

---

## Key Design Decisions

### 1. Bridge-side, not agent-side
Everything runs in the bridge. No hooks to install, no file watchers, no agent-side modifications. The bridge is the single source of truth.

### 2. Local-first, cloud-optional
Works fully offline with FTS-only search. Embeddings are an upgrade, not a requirement. This is the opposite of OneContext (cloud-required).

### 3. Extractive-first, LLM-optional
Fast summaries from turn data are available instantly. LLM summarization enhances quality but isn't blocking. OneContext blocks on cloud LLM; we don't.

### 4. Cross-agent by default
The data model is agent-agnostic. A Claude Code turn and a Codex turn are the same `turns` row with different `agent` values. Search works across all agents automatically.

### 5. Degradation, not failure
No Ollama? → Try cloud embeddings. No API keys? → FTS only. No FTS? → Recency-based. Each tier is still useful.

### 6. Zero config start
`memory.enabled = true` by default. Capture + store + FTS search work out of the box. User sees session history immediately. Everything else is progressive enhancement.
