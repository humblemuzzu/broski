# Phase 4 · Pi — the brief every agent works to

Read this whole file before anything else. It is the same for every agent in Phase 4 Pi (Step 0 foundation, Step 1 lanes A–F, Step 2 integration, Step 3 review and fix). Your own prompt adds your task.

## 1. What we are doing

Broski is a phone app that remote-controls coding agents on the user's Mac through a Bun/TypeScript bridge (`packages/bridge`). Phases 0–3 are done: the backend contract (`packages/bridge/src/contract/`), the bridge core (`src/core/`) and the app core (`lib/agent/`). Phase 4 moves each backend onto the contract. **Now: Pi.** We build one adapter, `packages/bridge/src/backends/pi/`, implementing `AgentBackend` on the pinned Pi SDK 1.4.0, so that it passes the contract's conformance suite and is correct against the SDK in every detail. Later (not you) the app is routed to it and the old Pi code is deleted.

The plan, with every design decision (D1–D20) and the file layout: [`PHASE-4-PI-PLAN.md`](PHASE-4-PI-PLAN.md). Read it fully. One Pi backend (`pi`); Pi Durable is **not** built now.

## 2. Sources of truth, in order

1. **The contract**: `packages/bridge/src/contract/*.ts` (the code is the truth) and `docs/architecture/contract/README.md` (the spec). Conformance: `src/contract/testing/` (`runConformance`, the 28 rules in `rules-*.ts`, the reference `fake-backend.ts` and its helpers — the fake is the model of correct adapter behaviour).
2. **The pinned SDK, 1.4.0**: `packages/bridge/node_modules/@earendil-works/{pi-coding-agent,pi-agent-core,pi-ai}/` — `dist/**/*.d.ts` for signatures, `dist/**/*.js` for behaviour, `dist/**/*.js.map` `sourcesContent` for the original TypeScript. Docs: `node_modules/@earendil-works/pi-coding-agent/docs/` and `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/`. Upstream `main` (newer) is at `reference/pi-mono/` — **never** code against `main`; use it only to understand.
3. **The research reports**: `docs/architecture/backends/pi/research/01..05-*.md`. They are good but written by another model: **verify every fact you rely on against the SDK code** before coding it. If a report is wrong, say so in your final report.
4. **The core and app-core docs**: `docs/architecture/core/README.md` (esp. §5 sessions, §7 interactions, §8 prompts, §16 how Phase 4 plugs in), `docs/architecture/app-core/README.md`.
5. **AGENTS.md** at the repo root (the "Backend contract" section).

When the contract and the plan disagree, the contract wins: report the conflict. When the SDK and a report disagree, the SDK wins.

## 3. Hard rules

- **Do not modify, move, delete or import the old Pi or Pi Durable code.** Read-only reference: `src/connectors/pi.ts`, `src/connectors/pi/**`, `src/connectors/pi_extension_ui.ts`, `src/connectors/pi-durable/**`, `src/handlers/pi_*.ts`, `src/handlers/pi_durable*`, `src/handlers/unified*.ts`, `src/runtime/pi-*.ts`, `src/transport/pi-durable-socket.ts`, `src/types/pi*.ts`, `src/index-cache/**` and every Pi file under `lib/`. You may **re-implement** a correct idea from them inside `backends/pi/` (the reports say which are correct: the serialized model refresh, the auth check, the byte-offset line index); never copy a bug.
- **Do not edit `src/contract/` or `src/core/`.** If the contract truly cannot express something the adapter needs, stop that item, keep the rest going, and write the gap in your final report (contract changes follow their own discipline).
- **Do not touch `lib/` (the app) or the Flutter tests.** Steps 4–5 are the owner's.
- **Only edit the files your prompt assigns you.** Another agent may be working beside you.
- **Layers** (`bun run check:layers`, `scripts/contract-gen/layers.ts`): `src/backends/pi/` imports only the contract (not `contract/testing/`), itself, `node:` built-ins (not `node:module`), and `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core` **from their package roots** (deep imports fail at runtime: the `exports` maps have only `.` and `./rpc-entry`). Not zod, not any bridge utility. Tests live in `src/__tests__/pi/` and may import `contract/testing/` and test helpers.
- **Never read or write the real `~/.pi`, `~/.claude`, `~/.codex`, `~/.broski`** — not in code paths you run, not in tests. Tests use a temp agent dir and a temp sessions dir (find the exact env vars/options in the SDK: e.g. `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, constructor options) and Pi's faux provider (`pi-ai`) or `src/__tests__/helpers/scripted-openai-server.ts`. Never call a real model.
- **No commits.** Leave changes in the working tree.

## 4. The quality bar (no AI slop)

- One concept per file; files well under 400 lines; functions under ~50 lines.
- Use SDK types (`import type` from the package roots). No `as any`, no `as unknown as`, no `@ts-ignore`, no non-null `!` to silence the compiler. A cast is allowed only where the SDK's own type is too wide and a runtime check proves the narrower one right next to it.
- Expected failures are `Rejected` values (`src/contract/rejection.ts`); a thrown error is a bug. `status()` never fails. Every string, list and map you hand the core is bounded (`src/contract/limits.ts`).
- **No timer, default or fallback ever answers an interaction for the human.** An interaction ends only when a human answers or cancels it, the backend withdraws it, or the extension's own `timeout` expires it.
- No `SessionManager.open` (or anything that writes) on a read path; no `applyOverrides`; no `session.reload()` while a run is on; never split a model id on `/`; never end a run on `agent_end` (only `agent_settled`).
- No dead code, no speculative options, no "for now", no TODO without the real fix named, no comments that restate the code. A comment exists only where a careful reader would otherwise misread the code, and then it cites the SDK `path:line` or contract rule that forces it.
- Match the repo's style (tabs in the bridge, biome). Run the formatter.
- Bounded memory and I/O: no unbounded maps, no whole-file reads where a span read does, no polling loops.

## 5. Verification protocol (mandatory, in your final report)

Before coding: for every SDK call you will make, open its `.d.ts` signature **and** its `.js` behaviour, and note the `path:line`. For every contract type or rule you implement, open its source.

After coding, do **at least three separate verification passes**, re-reading your own files from the top each time:

1. **SDK pass**: every SDK call, type, event and field you use, checked again against the 1.4.0 `dist` (signature, behaviour, errors, ordering). Fix anything wrong.
2. **Contract pass**: every value you return or emit checked against the contract's zod schemas and the README rules (bounds, ids, cursors, `Rejected` codes, event ordering, snapshot rules). Run the relevant conformance rules if your piece can be exercised.
3. **Slop pass**: dead code, duplication, guesses, unbounded growth, missing error paths at I/O boundaries, leaked listeners or timers, races, any rule in §4 broken, any old-Pi bug reproduced.

Then run, from `packages/bridge`: `bun run typecheck`, `bun run lint`, `bun run check:layers`, and `bun test src/__tests__/pi/` (plus any test you touched). All must pass for your files. Do not "fix" a failure in someone else's files: report it.

Your final message: files created/changed (with line counts); what each verification pass checked and what it fixed; every place you deviated from the plan or a report, and why; every fact you could not verify; contract gaps; anything the next step must know.
