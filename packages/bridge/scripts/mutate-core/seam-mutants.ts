import { type Mutant, mutantsOf } from "./mutant";

/** Mutants of fitting text and snapshots to the link. */
export const FIT_MUTANTS: Mutant[] = [
	...mutantsOf("core/wire-fit.ts", [
		{ name: "fit: the cap is ignored", find: "if (frame.bytes <= maxBytes) return frame;", replace: "return frame;" },
		{
			name: "fit: items are shed before text is cut",
			find: "return elided(message, maxBytes, log) ?? elided(trimmed, maxBytes, log);",
			replace: "return elided(trimmed, maxBytes, log);",
		},
		{
			name: "fit: items are never shed as a last resort",
			find: "return elided(message, maxBytes, log) ?? elided(trimmed, maxBytes, log);",
			replace: "return elided(message, maxBytes, log);",
		},
		{
			name: "fit: an event that cannot fit is never resynced",
			find: "if (SessionSnapshot.safeParse(after).success) {",
			replace: "if (false) {",
		},
		{
			name: "fit: a shortened message is not checked again",
			find: "\tif (!checked.success) {\n\t\tlog.error(`[core] a shortened",
			replace: "\tif (false) {\n\t\tlog.error(`[core] a shortened",
			equivalent:
				"cutting only shortens strings longer than MAX_PATH_CHARS, turns an edit flag false; no schema in the contract constrains such a string beyond its maximum, so a cut message always parses",
		},
		{
			name: "fit: open text keeps its head",
			find: '(path[snapshot.length] === "blocks" && path[snapshot.length + 2] === "text")',
			replace: "false",
		},
	]),
	...mutantsOf("core/snapshot-fit.ts", [
		{
			name: "fit: dropped items are not counted",
			find: "droppedItems: run.droppedItems + dropped",
			replace: "droppedItems: run.droppedItems",
		},
	]),
	...mutantsOf("core/text-elision.ts", [
		{
			name: "elide: edits stay editable when cut",
			find: "lock.holder[lock.flag] = whole;",
			replace: "",
		},
		{
			name: "elide: a lock is never lifted",
			find: "const whole = lock.candidates.every((item) => item.text.length <= limit);",
			replace:
				"const whole = lock.holder[lock.flag] === true && lock.candidates.every((item) => item.text.length <= limit);",
		},
		{ name: "elide: the tail is never kept", find: "scope.keepsTail(candidate.path)", replace: "false" },
		{ name: "elide: conditions are cut", find: " && !isCondition(path)", replace: "" },
		{
			name: "elide: text is cut below its floor",
			find: "const MIN_KEPT_UNITS = MAX_NAME_CHARS;",
			replace: "const MIN_KEPT_UNITS = 16;",
		},
		{
			name: "elide: the first estimate is final",
			find: "\twhile (failing - fitting > 1) {",
			replace: "\twhile (false) {",
		},
		{ name: "elide: a failing estimate is not corrected", find: "\t\ttarget += fittingOver;\n", replace: "" },
		{
			name: "elide: never bisects",
			find: "bisect = !bisect && 2 * (failing - fitting) > span;",
			replace: "bisect = false;",
			equivalent:
				"speed only: interpolation alone still narrows the bracket by at least one each step and ends on the same limit",
		},
		{
			name: "elide: a surrogate pair is split at the head",
			find: "isHighSurrogate(head.charCodeAt(head.length - 1)) ? head.slice(0, -1) : head",
			replace: "head",
		},
		{
			name: "elide: a surrogate pair is split at the tail",
			find: "isLowSurrogate(tail.charCodeAt(0)) ? tail.slice(1) : tail",
			replace: "tail",
		},
	]),
];

/** Mutants of the seam into the running bridge, the journal file, and the layer rules. */
export const SEAM_MUTANTS: Mutant[] = [
	...mutantsOf("server/contract-seam.ts", [
		{
			name: "seam: the core is told a frame has no size",
			find: ".receive(parsedFrame(raw), frameBytes(raw))",
			replace: ".receive(parsedFrame(raw), 0)",
		},
		{
			name: "seam: unparsable text is not answered",
			find: "\t} catch {\n\t\treturn null;\n\t}",
			replace: "\t} catch (error) {\n\t\tthrow error;\n\t}",
		},
		{ name: "seam: a disconnect is ignored", find: "connections.get(ws)?.close();", replace: "" },
		{ name: "seam: stop disposes nothing", find: "stop: () => core.dispose(),", replace: "stop: async () => {}," },
		{
			name: "seam: a hold reaches no core",
			find: "hold: (session) => core.hold(session),",
			replace: 'hold: async () => ({ status: "accepted" as const }),',
		},
		{
			name: "seam: a release reaches no core",
			find: "release: (session) => core.release(session),",
			replace: "release: () => {},",
		},
		{
			name: "seam: no backend ever starts",
			find: "for (const [id, factory] of backends) void core.addBackend(id, factory);",
			replace: "",
		},
		{
			name: "seam: a rate-limited frame is not answered",
			find: "refuse: (ws, raw) => connectionOf(ws).refuse(parsedFrame(raw)),",
			replace: "refuse: () => {},",
		},
		{
			name: "seam: a backend may be configured twice",
			find: "if (new Set(ids).size !== ids.length) throw",
			replace: "if (false) throw",
		},
	]),
	...mutantsOf("server/json-lines-journal.ts", [
		{ name: "journal: the real-home guard is gone", find: "assertNotRealHome(path, what);", replace: "" },
		{
			name: "journal: appended lines are world-readable",
			find: "}\\n`, { mode: 0o600 });",
			replace: "}\\n`, { mode: 0o644 });",
		},
		{
			name: "journal: a rewrite is world-readable",
			find: '.join(""), { mode: 0o600 });',
			replace: '.join(""), { mode: 0o644 });',
		},
		{
			name: "journal: its directory is world-readable",
			find: "{ recursive: true, mode: 0o700 }",
			replace: "{ recursive: true, mode: 0o755 }",
		},
		{ name: "journal: a torn append glues the next", find: "\t\t\t\ttorn = true;\n", replace: "" },
		{
			name: "journal: never compacted while running",
			find: "if (lines <= 2 * keep) return;",
			replace: "return;",
		},
		{
			name: "journal: bad lines are not rewritten away",
			find: "if (found.entries.length !== found.lines) compact(found.entries);",
			replace: "",
		},
	]),
	...mutantsOf("server/connections.ts", [
		{ name: "connections: a closed socket keeps its sessions", find: "deps.contract.disconnect(ws);", replace: "" },
		{
			name: "connections: the rate limit refuses nothing",
			find: "if (!withinRateLimit(ws)) {",
			replace: "if (false) {",
		},
	]),
	...mutantsOf("server/shutdown.ts", [
		{
			name: "shutdown: the core is not stopped",
			find: "disposeBackends: () => deps.contract.stop(),",
			replace: "disposeBackends: () => {},",
		},
	]),
	...mutantsOf("server.ts", [{ name: "server: backends never start", find: "\tcontract.start();\n", replace: "" }]),
	...mutantsOf("contract/session-reducer.ts", [
		{
			name: "reducer: an open block grows past its bound",
			find: "text: newestText(block.text + event.text)",
			replace: "text: block.text + event.text",
		},
	]),
	...mutantsOf("../scripts/contract-gen/layers.ts", [
		{
			name: "layers: the infrastructure is not judged",
			find: "if (infrastructureOf(layout).has(withoutExtension(file.path))) {",
			replace: "if (false) {",
		},
		{
			name: "layers: the infrastructure may import anything",
			find: "return infrastructure.has(withoutExtension(resolve(dirname(file.path), specifier)))",
			replace: "return true",
		},
		{
			name: "layers: the core may not use its infrastructure",
			find: "infrastructure.has(withoutExtension(target));",
			replace: "false;",
		},
	]),
];
