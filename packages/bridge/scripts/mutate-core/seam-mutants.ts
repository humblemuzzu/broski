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
				"cutting only shortens strings longer than MAX_PATH_CHARS and turns an edit flag false; no schema in the contract constrains such a string beyond its maximum, so a cut message always parses",
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
			find: "lock.holder[lock.flag] = lock.editable && whole;",
			replace: "",
		},
		{
			name: "elide: a lock is never lifted",
			find: "const whole = lock.candidates.every((item) => item.text.length <= limit);",
			replace:
				"const whole = lock.holder[lock.flag] === true && lock.candidates.every((item) => item.text.length <= limit);",
		},
		{
			name: "elide: a read-only file becomes editable when whole",
			find: "lock.holder[lock.flag] = lock.editable && whole;",
			replace: "lock.holder[lock.flag] = whole;",
		},
		{
			name: "elide: a cut file is not marked truncated",
			find: "if (lock.cutFlag) lock.holder[lock.cutFlag] = !whole;",
			replace: "",
		},
		{
			name: "elide: a file's text is never locked",
			find: "requestLock(tree, candidate.path) ?? fileLock(tree, candidate.path)",
			replace: "requestLock(tree, candidate.path)",
		},
		{
			name: "elide: any text beside a revision is a file's",
			find: 'if (path.at(-1) !== "text") return undefined;',
			replace: "",
			equivalent:
				"no input reaches it: only an `EditableFile` has a boolean `truncated` and a string `revision`, and of its strings only `text` and the entries of `problems` can be long enough to cut, a problem's parent being the list",
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
			name: "seam: owns any object",
			find: " && !Array.isArray(frame) && frame.type === CONTRACT_FRAME_TYPE",
			replace: " && frame.type === CONTRACT_FRAME_TYPE",
			equivalent:
				"a list has no `type` property, so it is never owned either way; the check is there for the type narrowing",
		},
		{ name: "seam: owns everything", find: "&& frame.type === CONTRACT_FRAME_TYPE;", replace: "&& true;" },
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
			name: "seam: a rate-limited contract frame is left to the old protocol",
			find: "\t\t\tconnectionOf(ws).refuse(frame);\n\t\t\treturn true;",
			replace: "\t\t\treturn false;",
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
	...mutantsOf("server/messages.ts", [
		{
			name: "messages: the old poison check runs before the core",
			find: "\t\tif (deps.contract.owns(parsed)) return deps.contract.receive(ws, parsed, frameBytes(raw));\n\t\tif (hasPrototypePoisonKeys(parsed)) {",
			replace:
				'\t\tif (hasPrototypePoisonKeys(parsed)) { deps.send(ws, { type: "error", message: "Invalid JSON payload" }); return; }\n\t\tif (deps.contract.owns(parsed)) return deps.contract.receive(ws, parsed, frameBytes(raw));\n\t\tif (hasPrototypePoisonKeys(parsed)) {',
		},
		{
			name: "messages: contract frames go to the old routes",
			find: "if (deps.contract.owns(parsed)) return",
			replace: "if (false) return",
		},
		{
			name: "messages: the core is told a frame has no size",
			find: "deps.contract.receive(ws, parsed, frameBytes(raw))",
			replace: "deps.contract.receive(ws, parsed, 0)",
		},
	]),
	...mutantsOf("server/connections.ts", [
		{ name: "connections: a closed socket keeps its sessions", find: "deps.contract.disconnect(ws);", replace: "" },
		{
			name: "connections: rate-limited contract frames get the old refusal",
			find: "if (deps.contract.refuse(ws, raw)) return;",
			replace: "",
		},
	]),
	...mutantsOf("server/shutdown.ts", [
		{ name: "shutdown: the core is not stopped", find: "() => deps.contract.stop()", replace: "" },
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
