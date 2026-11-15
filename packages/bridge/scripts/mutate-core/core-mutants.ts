import { type Mutant, mutantsOf } from "./mutant";

/** Mutants of the session machinery: registry, hub, live stream, sinks, clients, keep-open. */
export const SESSION_MUTANTS: Mutant[] = [
	...mutantsOf("core/backend-registry.ts", [
		{
			name: "registry: a backend may be registered twice",
			find: "if (this.backends.has(id) || this.starts.has(id)) throw",
			replace: "if (false) throw",
		},
		{ name: "registry: requests do not wait for a start", find: "await this.starts.get(id)?.ready;", replace: "" },
		{
			name: "registry: a start is waited for without end",
			find: "BACKEND_START_WAIT_MS, resolve)",
			replace: "1e15, resolve)",
		},
		{
			name: "registry: the wait timer outlives the start",
			find: "\t\t\tstart.cancelWait();\n\t\t\tthis.starts",
			replace: "\t\t\tthis.starts",
		},
		{
			name: "registry: dispose keeps the wait timers",
			find: "\t\t\tstart.cancelWait();\n\t\t\tstart.release();",
			replace: "\t\t\tstart.release();",
		},
		{ name: "registry: dispose leaves waiters waiting", find: "\t\t\tstart.release();\n", replace: "" },
		{ name: "registry: a wrong-id backend is kept", find: "if (backend.id !== id) {", replace: "if (false) {" },
		{
			name: "registry: a wrong-id backend is not disposed",
			find: "\t\t\tawait this.disposeQuietly(backend);\n\t\t\treturn this.failed",
			replace: "\t\t\treturn this.failed",
		},
		{
			name: "registry: a backend landing after dispose is kept",
			find: "if (this.disposed) {",
			replace: "if (false) {",
		},
		{ name: "registry: an arrival is not announced", find: "this.deps.onArrival(backend);", replace: "" },
		{
			name: "registry: a failure reason is not kept",
			find: "this.failures.set(id, clip(reason, MAX_ISSUE_CHARS));",
			replace: "",
		},
		{ name: "registry: a failure reason is not bounded", find: "clip(reason, MAX_ISSUE_CHARS)", replace: "reason" },
		{
			name: "registry: a start still running is called missing",
			find: "if (this.starts.has(id)) return",
			replace: "if (false) return",
		},
		{
			name: "registry: an invalid status passes",
			find: "if (checked.success) return checked.data;",
			replace: "return reported.value;",
		},
		{
			name: "registry: a status message is not bounded",
			find: "clip(message, MAX_ISSUE_CHARS)",
			replace: "message",
		},
		{
			name: "registry: a failed dispose is not logged",
			find: "if (!disposed.ok) this.deps.log.error",
			replace: "if (false) this.deps.log.error",
		},
	]),
	...mutantsOf("core/holds.ts", [
		{
			name: "holds: holds are not counted",
			find: "this.counts.set(key, (this.counts.get(key) ?? 0) + 1);",
			replace: "this.counts.set(key, 1);",
		},
		{
			name: "holds: holds go below zero",
			find: "\t\tif (left > 0) this.counts.set(at, left);\n\t\telse this.counts.delete(at);",
			replace: "\t\tthis.counts.set(at, left);",
		},
		{
			name: "holds: a release of the old key does not follow the move",
			find: "moved !== undefined && !this.counts.has(at);",
			replace: "false;",
		},
		{
			name: "holds: a move drops the holds it carries",
			find: "this.counts.set(to, (this.counts.get(to) ?? 0) + count);",
			replace: "",
		},
	]),
	...mutantsOf("core/session-hub.ts", [
		{ name: "hub: a hold does not hold", find: " && !this.holds.has(live.key)", replace: "" },
		{
			name: "hub: a hold whose open failed is kept",
			find: "\t\t\tthis.holds.drop(key);\n\t\t\treturn live;",
			replace: "\t\t\treturn live;",
		},
		{
			name: "hub: a hold of an open session leaves its idle close set",
			find: '\t\tthis.reviewIdle(live);\n\t\treturn { status: "accepted" };',
			replace: '\t\treturn { status: "accepted" };',
		},
		{
			name: "hub: a release never lets the session close",
			find: "\t\tconst live = this.live.get(this.holds.drop(sessionKey(ref)));\n\t\tif (live) this.reviewIdle(live);",
			replace: "\t\tthis.holds.drop(sessionKey(ref));",
		},
		{
			name: "hub: a release of a replaced session's ref reviews the old key",
			find: "this.live.get(this.holds.drop(sessionKey(ref)))",
			replace: "(this.holds.drop(sessionKey(ref)), this.live.get(sessionKey(ref)))",
		},
		{
			name: "hub: a replaced session leaves its holds behind",
			find: "\t\tthis.holds.move(old.key, next.key);\n",
			replace: "",
		},
		{ name: "hub: concurrent opens are not shared", find: "if (pending) return pending;", replace: "" },
		{ name: "hub: a live session is opened again", find: "if (known) return Promise.resolve(known);", replace: "" },
		{
			name: "hub: an open does not wait for the previous close",
			find: "await this.closing.get(sessionKey(ref));",
			replace: "",
		},
		{
			name: "hub: an open is waited for without end",
			find: "SESSION_CALL_DEADLINE_MS, opening,",
			replace: "1e15, opening,",
		},
		{
			name: "hub: a late open is neither closed nor waited for",
			find: "this.settleLate(target, opening, label);",
			replace: "",
		},
		{
			name: "hub: the next open does not wait for a late open",
			find: 'if (target.kind === "existing") this.awaitEnd',
			replace: "if (false) this.awaitEnd",
		},
		{ name: "hub: a thrown open is not caught", find: "if (!outcome.ok) {", replace: "if (false) {" },
		{
			name: "hub: an invalid open snapshot is taken",
			find: "if (!checked.success || this.disposed) {",
			replace: "if (this.disposed) {",
		},
		{
			name: "hub: an open landing at shutdown is kept",
			find: "if (!checked.success || this.disposed) {",
			replace: "if (!checked.success) {",
		},
		{
			name: "hub: an opened session is never reviewed",
			find: "\t\tsink.deliverTo(live);\n\t\tthis.reviewIdle(live);",
			replace: "\t\tsink.deliverTo(live);",
		},
		{ name: "hub: events never review the idle close", find: "else this.reviewIdle(live);", replace: "" },
		{ name: "hub: a resolution never reaches the desk", find: "this.deps.onEvent(live, record, before);", replace: "" },
		{ name: "hub: a replaced stream keeps no claims", find: "\t\t\told.claims,\n", replace: "" },
		{
			name: "hub: a close is waited for without end",
			find: "SESSION_CALL_DEADLINE_MS, ended,",
			replace: "1e15, ended,",
		},
		{
			name: "hub: leaving never reviews the idle close",
			find: "\t\tlive.viewers.delete(viewer);\n\t\tthis.reviewIdle(live);",
			replace: "\t\tlive.viewers.delete(viewer);",
		},
		{ name: "hub: a deleted session stays open", find: "if (live) this.close(live);", replace: "" },
		{
			name: "hub: retiring keeps the idle timer",
			find: "\t\tlive.cancelIdleClose?.();\n\t\tlive.cancelIdleClose = undefined;\n\t\tthis.live",
			replace: "\t\tthis.live",
		},
		{
			name: "hub: retired viewers still view",
			find: "for (const viewer of live.viewers) viewer.forget(live);",
			replace: "",
		},
		{
			name: "hub: the idle timer is never cancelled",
			find: "\t\t\tlive.cancelIdleClose();\n\t\t\tlive.cancelIdleClose = undefined;\n\t\t}",
			replace: "\t\t}",
		},
		{
			name: "hub: the closing entry outlives its close",
			find: "if (this.closing.get(key) === done) this.closing.delete(key);",
			replace: "",
			equivalent:
				"memory only: a settled entry stays in `closing`, and awaiting a settled promise changes no order a test or a phone can see",
		},
	]),
	...mutantsOf("core/live-session.ts", [
		{ name: "live: records after close are published", find: "if (this.closed) return;", replace: "" },
		{ name: "live: invalid records are published", find: "if (checked.success) {", replace: "if (true) {" },
		{
			name: "live: reconcile never resyncs",
			find: "if (sameState(this.state, this.open.snapshot())) return;",
			replace: "return;",
		},
		{
			name: "live: an invalid adapter snapshot is published",
			find: "\t\tif (!checked.success) {\n\t\t\tthis.deps.log.error(\n",
			replace: "\t\tif (false) {\n\t\t\tthis.deps.log.error(\n",
		},
		{ name: "live: any epoch replays", find: "if (resume?.epoch === this.epoch) {", replace: "if (resume) {" },
		{ name: "live: events are not logged for replay", find: "this.log.push(this.seq, frame);", replace: "" },
		{ name: "live: the hub never hears of an event", find: "this.deps.published(this, record, before);", replace: "" },
		{
			name: "live: the observer is given the state after as the state before",
			find: "const before = this.state;\n\t\tthis.state = applyEvent(before, record);",
			replace: "this.state = applyEvent(this.state, record);\n\t\tconst before = this.state;",
		},
	]),
	...mutantsOf("core/observer.ts", [
		{ name: "observer: it is never told", find: "this.observer.observe(observed);", replace: "" },
		{
			name: "observer: a throwing observer escapes into the adapter",
			find: "} catch (error) {",
			replace: "} catch (error) { throw error;",
		},
		{
			name: "observer: a backend that never answers is given a row",
			find: "if (outcome === undefined) return undefined;",
			replace: "if (outcome === undefined) return { session: ref } as SessionSummary;",
		},
		{
			name: "observer: a row that breaks the contract is passed on",
			find: "return checked.success ? checked.data : undefined;",
			replace: "return outcome.value.summary;",
		},
		{
			name: "observer: a backend that is gone is looked up anyway",
			find: "if (!backend) return undefined;",
			replace: "",
		},
	]),
	...mutantsOf("core/core.ts", [
		{
			name: "core: the observer is never given an event",
			find: "observation.publish(live, record, before);",
			replace: "",
		},
		{
			name: "core: a hold of a backend not served reaches the hub",
			find: 'return "backend" in reached ? this.hub.hold(reached.backend, ref)',
			replace: "return true ? this.hub.hold(reached.backend, ref)",
		},
		{ name: "core: a release does nothing", find: "\t\tthis.hub.release(ref);", replace: "" },
	]),
	...mutantsOf("core/session-sink.ts", [
		{ name: "sink: early records are lost", find: "for (const record of held) this.emit(record);", replace: "" },
		{
			name: "sink: a failure throws into the adapter",
			find: "} catch (error) {",
			replace: "} catch (error) { throw error;",
		},
	]),
	...mutantsOf("core/client.ts", [
		{ name: "client: a gone client is still sent frames", find: "if (!this.connected) return;", replace: "" },
		{
			name: "client: a throwing link stops the fan-out",
			find: "} catch (error) {",
			replace: "} catch (error) { throw error;",
		},
		{
			name: "client: attach and detach run out of order",
			find: "(this.steps.get(key) ?? Promise.resolve()).then(step)",
			replace: "Promise.resolve().then(step)",
		},
		{ name: "client: control does not wait for attaches", find: "\t\tawait this.steps.get(key);\n", replace: "" },
		{
			name: "client: attaches under way take no place",
			find: "this.attached.size + this.reserved >= limit",
			replace: "this.attached.size >= limit",
		},
		{ name: "client: a place is never given back", find: "\t\tthis.reserved -= 1;", replace: "" },
		{
			name: "client: finished steps are kept",
			find: "if (this.steps.get(key) === tail) this.steps.delete(key);",
			replace: "",
			equivalent:
				"memory only: a settled tail stays per session key, and waiting on it adds no order a test or a phone can see",
		},
	]),
	...mutantsOf("core/keep-open.ts", [
		{ name: "keep-open: a run does not hold", find: "snapshot.run !== undefined ||", replace: "false ||" },
		{ name: "keep-open: an ask does not hold", find: "snapshot.interactions.length > 0 ||", replace: "false ||" },
		{
			name: "keep-open: a compaction does not hold",
			find: "snapshot.compaction !== undefined ||",
			replace: "false ||",
		},
		{ name: "keep-open: a retry does not hold", find: "snapshot.retry !== undefined ||", replace: "false ||" },
		{ name: "keep-open: queued input does not hold", find: "snapshot.queue.length > 0", replace: "false" },
	]),
	...mutantsOf("core/deadline.ts", [
		{
			name: "deadline: the timer outlives the work",
			find: "\t\t\t\tcancel();\n\t\t\t\tresolve(value);",
			replace: "\t\t\t\tresolve(value);",
		},
		{
			name: "deadline: a call that throws at once escapes",
			find: "\t\twork = call();\n\t} catch (error) {",
			replace: "\t\twork = call();\n\t} catch (error) { throw error;",
		},
	]),
	...mutantsOf("core/event-log.ts", [
		{ name: "log: replays from beyond the stream", find: "if (seq > lastSeq) return undefined;", replace: "" },
		{ name: "log: off by one at its oldest", find: "seq < oldest.seq - 1", replace: "seq < oldest.seq" },
		{ name: "log: no byte bound", find: "(this.bytes > this.window.maxBytes && this.size() > 1)", replace: "false" },
		{ name: "log: may drop its newest", find: "&& this.size() > 1)", replace: "&& this.size() > 0)" },
	]),
];
