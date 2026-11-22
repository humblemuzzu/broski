import { type Mutant, mutantsOf } from "./mutant";

/** Mutants of what the core adds on its own: the cache clock, the bridge's asks and notices, and the fallbacks. */
export const SMARTS_MUTANTS: Mutant[] = [
	...mutantsOf("core/live-session.ts", [
		{
			name: "live: reconcile ignores the bridge's own state",
			find: "this.deps.layer.onto(this, this.open.snapshot())",
			replace: "this.open.snapshot()",
		},
		{
			name: "live: adapter records are published as they came",
			find: "this.publish(this.deps.layer.enrich(this, record));",
			replace: "this.publish(record);",
		},
	]),
	...mutantsOf("core/session-hub.ts", [
		{
			name: "hub: a closed stream's own asks never expire",
			find: "\t\tthis.deps.ending(live);\n\t\tthis.retire(live);\n\t\tthis.awaitEnd",
			replace: "\t\tthis.retire(live);\n\t\tthis.awaitEnd",
		},
		{
			name: "hub: shutdown never expires the bridge's own asks",
			find: "\t\t\tthis.deps.ending(live);\n\t\t\tthis.retire(live);",
			replace: "\t\t\tthis.retire(live);",
		},
		{ name: "hub: a replacing stream drops the bridge's own state", find: "\t\t\told.extras,\n", replace: "" },
	]),
	...mutantsOf("core/cache-clock.ts", [
		{
			name: "cache: the window is never laid on a snapshot",
			find: "return cache ? { ...snapshot, usage: { ...snapshot.usage, cache } } : snapshot;",
			replace: "return snapshot;",
		},
		{
			name: "cache: a backend's window is never stamped",
			find: "cache.lastTouchAt > 0 ? cache :",
			replace: "true ? cache :",
		},
		{
			name: "cache: a backend's window gets no request tokens",
			find: "...(cache.cachedTokens === undefined && turn && { cachedTokens: turn.read }),",
			replace: "",
		},
		{
			name: "cache: totals that did not move restamp the window",
			find: "if (turn.read === 0 && turn.write === 0) return undefined;",
			replace: "",
		},
		{
			name: "cache: session totals are taken as one request's",
			find: "before !== undefined && total >= before ? total - before : total",
			replace: "total",
		},
		{
			name: "cache: a request that touched nothing drops the window",
			find: "const cache = next ?? this.windows.get(key);",
			replace: "const cache = next;",
		},
	]),
	...mutantsOf("core/bridge-layer.ts", [
		{
			name: "layer: the bridge's asks are left out of a snapshot",
			find: "interactions: withAsks(snapshot.interactions, live.extras, live.snapshot.interactions),",
			replace: "interactions: snapshot.interactions,",
		},
		{
			name: "layer: the bridge's queue is left out of a snapshot",
			find: "queue: withQueued(snapshot.queue, live.extras),",
			replace: "queue: snapshot.queue,",
		},
		{
			name: "layer: an adapter's resync drops the bridge's state",
			find: "return { ...record, event: { ...event, snapshot: this.onto(live, event.snapshot) } };",
			replace: "return record;",
		},
		{
			name: "layer: a run's end leaves its asks pending",
			find: "this.externals.runEnding(live, event.runId);",
			replace: "",
		},
	]),
	...mutantsOf("core/external-interactions.ts", [
		{
			name: "external: an aborted signal withdraws nothing",
			find: 'signal.addEventListener("abort", withdraw, { once: true });',
			replace: "",
		},
		{
			name: "external: an ask that ends keeps its hold",
			find: "\t\t\t\tthis.deps.release(ref);\n\t\t\t\tresolve(outcome);",
			replace: "\t\t\t\tresolve(outcome);",
		},
		{
			name: "external: a reply that stops the run leaves it going",
			find: "if (replyStopsRun(ask.interaction.request, answer.reply)) void this.stopRun(live);",
			replace: "",
		},
		{
			name: "external: an ask outside a run blocks one",
			find: "blocksRun: runId !== undefined && spec.blocksRun !== false,",
			replace: "blocksRun: spec.blocksRun !== false,",
		},
		{
			name: "external: a notice is not bounded",
			find: "level: spec.level, text: clip(spec.text, MAX_TEXT_CHARS) };",
			replace: "level: spec.level, text: spec.text };",
		},
	]),
	...mutantsOf("core/answering.ts", [
		{
			name: "phone answer: a bridge ask's answer reaches the adapter",
			find: "external ?? live.open.control ?? sessionAnswerer(live.open)",
			replace: "live.open.control ?? sessionAnswerer(live.open)",
		},
	]),
	...mutantsOf("core/bridge-answer.ts", [
		{
			name: "answer: a lock-screen answer to a bridge ask reaches the adapter",
			find: "deps.externals.answerer(live, answer.interactionId) ?? ",
			replace: "",
		},
	]),
	...mutantsOf("core/fallbacks.ts", [
		{
			name: "fallbacks: a backend that queues itself is stood in for",
			find: 'this.options.queue === true && !this.modesOf(live).includes("queue")',
			replace: "this.options.queue === true",
		},
		{
			name: "fallbacks: a backend that steers itself is stood in for",
			find: 'this.options.steer === true && !this.modesOf(live).includes("steer")',
			replace: "this.options.steer === true",
		},
		{
			name: "fallbacks: a native fork is passed over",
			find: "if (backend.fork) return backend.fork(ref, at);",
			replace: "",
		},
		{ name: "fallbacks: the queue is not described", find: 'if (this.options.queue) modes.add("queue");', replace: "" },
		{
			name: "fallbacks: the bridge's queue cannot be cancelled from the phone",
			find: "own.cancelQueued || (own.controllable && this.queues(live))",
			replace: "own.cancelQueued",
		},
		{
			name: "fallbacks: a handoff rides on every prompt",
			find: 'if (sent !== input && result.status === "accepted") this.forks.taken(live.ref);',
			replace: "",
		},
		{
			name: "fallbacks: a run's end wakes no steer",
			find: "for (const ended of [...live.extras.runEnds]) ended();",
			replace: "",
		},
	]),
	...mutantsOf("core/bridge-queue.ts", [
		{ name: "queue: a run's end starts nothing", find: "else void this.dispatch(live);", replace: "" },
		{
			name: "queue: an aborted run keeps its queue",
			find: 'if (event.outcome.kind === "aborted") this.returnAll(live);',
			replace: "if (false) this.returnAll(live);",
		},
		{
			name: "queue: a steer's restart gives the queue back",
			find: " || live.extras.restarting) return;",
			replace: ") return;",
		},
		{ name: "queue: no bound", find: "if (extras.queued.length >= MAX_BRIDGE_QUEUE) {", replace: "if (false) {" },
		{
			name: "queue: the head is sent while the adapter still runs",
			find: "\t\tawait Promise.resolve();\n",
			replace: "",
		},
		{
			name: "queue: an unknown item is cancelled",
			find: "if (kept.length === live.extras.queued.length) return rejected(",
			replace: "if (false) return rejected(",
		},
	]),
	...mutantsOf("core/steer-fallback.ts", [
		{
			name: "steer: a run that never stops is waited for without end",
			find: "this.clock.after(STEER_STOP_MS,",
			replace: "this.clock.after(1e15,",
		},
		{
			name: "steer: the restart is never over",
			find: "\t\t} finally {\n\t\t\tlive.extras.restarting = false;",
			replace: "\t\t} finally {",
		},
	]),
	...mutantsOf("core/portable-fork.ts", [
		{ name: "fork: the fork point is crossed", find: 'if (at.position === "before") continue;', replace: "" },
		{
			name: "fork: the handoff has no bound",
			find: "const budget = MAX_HANDOFF_CHARS - OPENING.length - CLOSING.length;",
			replace: "const budget = Number.MAX_SAFE_INTEGER;",
		},
	]),
	...mutantsOf("server/contract-seam.ts", [
		{
			name: "seam: production serves no fallbacks",
			find: "\t\tfallbacks: { queue: true, steer: true, portableFork: true },\n",
			replace: "",
		},
		{
			name: "seam: a bridge ask reaches no core",
			find: "raiseExternalInteraction: (session, spec, signal) => core.raiseExternalInteraction(session, spec, signal),",
			replace: 'raiseExternalInteraction: async () => ({ kind: "ended" as const, reason: "withdrawn" as const }),',
		},
		{
			name: "seam: a bridge notice reaches no core",
			find: "emitExternalNotice: (session, notice) => core.emitExternalNotice(session, notice),",
			replace: 'emitExternalNotice: async () => ({ status: "accepted" as const }),',
		},
	]),
];
