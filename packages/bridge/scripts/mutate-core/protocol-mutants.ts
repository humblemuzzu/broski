import { type Mutant, mutantsOf } from "./mutant";

/** Mutants of the wire: the protocol server, the handlers, the desk and ledger, fitting the link. */
export const PROTOCOL_MUTANTS: Mutant[] = [
	...mutantsOf("core/protocol-server.ts", [
		{ name: "protocol: no frame-size bound", find: "bytes > MAX_MESSAGE_BYTES ?", replace: "false ?" },
		{ name: "protocol: no shape walk", find: ": shapeProblem(message);", replace: ": undefined;" },
		{ name: "protocol: no hello gate", find: 'if (type !== "hello" && !client.negotiated) {', replace: "if (false) {" },
		{
			name: "protocol: a request may be answered twice",
			find: "\t\t\tif (answered) {\n",
			replace: "\t\t\tif (false) {\n",
		},
		{
			name: "protocol: no request deadline",
			find: "this.ctx.clock.after(REQUEST_DEADLINE_MS,",
			replace: "this.ctx.clock.after(1e15,",
		},
		{
			name: "protocol: the deadline timer outlives the request",
			find: "\t\t} finally {\n\t\t\tcancel();\n\t\t}",
			replace: "\t\t}",
		},
		{
			name: "protocol: a thrown handler goes unanswered",
			find: 'if (!answered) respond(protocolError(requestId, "internal"',
			replace: 'if (false) respond(protocolError(requestId, "internal"',
		},
		{
			name: "protocol: invalid answers leave",
			find: "\t\tif (!checked.success) {\n\t\t\tthis.ctx.log.error(`[core] an answer breaks",
			replace: "\t\tif (false) {\n\t\t\tthis.ctx.log.error(`[core] an answer breaks",
		},
		{
			name: "protocol: an answer too large is sent anyway",
			find: "\t\tif (frame) {\n\t\t\tclient.send(frame);\n\t\t\treturn true;\n\t\t}",
			replace: "\t\tclient.send(frame ?? encodeFrame(message));\n\t\treturn true;",
		},
		{
			name: "protocol: a refused frame gets no answer",
			find: '\t\tthis.deliver(client, protocolError(requestId, "rate_limited", text), requestId);',
			replace: "",
		},
		{
			name: "protocol: no requestId is ever read back",
			find: "return parsed.success ? parsed.data : undefined;",
			replace: "return undefined;",
		},
	]),
	...mutantsOf("core/message-shape.ts", [
		{ name: "shape: no value budget", find: "if (values > MAX_CLIENT_MESSAGE_VALUES)", replace: "if (false)" },
		{ name: "shape: no depth bound", find: "if (depth >= MAX_MESSAGE_DEPTH)", replace: "if (false)" },
		{ name: "shape: no list bound", find: "value.length > MAX_LIST_ITEMS", replace: "false" },
		{ name: "shape: no key bound", find: "hasMoreKeys(value, MAX_LIST_ITEMS)", replace: "false" },
		{ name: "shape: one level too deep allowed", find: "MAX_JSON_DEPTH + 3", replace: "MAX_JSON_DEPTH + 4" },
		{ name: "shape: one level too shallow", find: "MAX_JSON_DEPTH + 3", replace: "MAX_JSON_DEPTH + 2" },
	]),
	...mutantsOf("core/frame.ts", [
		{ name: "frame: extra keys pass", find: "keys.length === 2", replace: "keys.length >= 2" },
		{
			name: "frame: a lone surrogate is written as it is",
			find: "wellFormedJson(message)",
			replace: "JSON.stringify(message)",
		},
	]),
	...mutantsOf("core/well-formed-json.ts", [
		{
			name: "frame: a lone surrogate keeps its escape",
			find: "lone === undefined ? match : REPLACEMENT_ESCAPE",
			replace: "match",
		},
		{ name: "frame: a literal escape is rewritten", find: "/\\\\\\\\|(", replace: "/(" },
	]),
	...mutantsOf("core/directories.ts", [
		{
			name: "directories: a refusal is called invalid_input whatever its reason",
			find: "pathRefusal(cwd, secure.refused)",
			replace: '({ status: "rejected" as const, rejection: { code: "invalid_input" as const, message: "no" } })',
		},
	]),
	...mutantsOf("core/secure-path.ts", [
		{
			name: "directories: a path outside the bases is not forbidden",
			find: 'case "outside":\n\t\t\treturn rejected("forbidden"',
			replace: 'case "outside":\n\t\t\treturn rejected("invalid_input"',
		},
		{
			name: "directories: a missing path is not not_found",
			find: 'case "missing":\n\t\t\treturn rejected("not_found"',
			replace: 'case "missing":\n\t\t\treturn rejected("invalid_input"',
		},
	]),
	...mutantsOf("core/client.ts", [
		{
			name: "hello: any major agrees",
			find: "this.agreed = theirs.major === ours.major;",
			replace: "this.agreed = true;",
		},
	]),
	...mutantsOf("core/requests-catalog.ts", [
		{
			name: "hello: another major keeps the sessions",
			find: "for (const live of client.detachAll()) ctx.hub.leave(live, client);",
			replace: "",
		},
		{
			name: "directories: models skip the policy",
			find: 'const directory = await allowedOptionalDirectory(ctx.directories, request.cwd);\n\t\tconst result = directory?.status === "rejected" ? directory : await backend.listModels',
			replace:
				'const directory = request.cwd === undefined ? undefined : { status: "allowed" as const, cwd: request.cwd };\n\t\tconst result = directory?.status === "rejected" ? directory : await backend.listModels',
		},
		{
			name: "directories: sessions skip the policy",
			find: "allowedOptionalDirectory(ctx.directories, request.query.cwd)",
			replace: "Promise.resolve(undefined)",
		},
	]),
	...mutantsOf("core/requests-sessions.ts", [
		{
			name: "directories: create skips the policy",
			find: "await allowedDirectory(ctx.directories, request.options.cwd)",
			replace: '({ status: "allowed" as const, cwd: request.options.cwd })',
		},
	]),
	...mutantsOf("core/context.ts", [
		{
			name: "context: an unknown backend is served",
			find: 'if ("backend" in reached) return reached.backend;',
			replace: "return reached.backend;",
		},
	]),
	...mutantsOf("core/controlled.ts", [
		{
			name: "control: needs no attach",
			find: "\t\tif (!live) {\n\t\t\tif (await reachBackend",
			replace: "\t\tif (false) {\n\t\t\tif (await reachBackend",
		},
		{
			name: "control: unknown backend answered twice",
			find: "if (await reachBackend(ctx, request.session.backend, request.requestId, respond)) {",
			replace: "if ((await reachBackend(ctx, request.session.backend, request.requestId, respond)) || true) {",
		},
		{
			name: "control: a watched session is controlled",
			find: 'control ? run({ ...target, control }) : rejected("unsupported", WATCH_ONLY)',
			replace: "run({ ...target, control: control ?? ({} as SessionControl) })",
		},
	]),
	...mutantsOf("core/requests-live.ts", [
		{
			name: "attach: no viewing cap",
			find: "if (reserved && !client.reserve(MAX_SESSIONS_PER_CLIENT)) {",
			replace: "if (false) {",
		},
		{ name: "attach: a place is kept after the attach", find: "if (reserved) client.release();", replace: "" },
		{ name: "attach: a gone client is answered and attached", find: "\tif (!client.connected) return;\n", replace: "" },
		{
			name: "attach: a client that lost its hello is attached",
			find: "\tif (!client.negotiated) {\n",
			replace: "\tif (false) {\n",
		},
		{
			name: "attach: a session gone while opening is attached",
			find: "\tif (live.closed) {\n",
			replace: "\tif (false) {\n",
		},
		{ name: "attach: no reconcile", find: "\tlive.reconcile();\n", replace: "" },
		{ name: "attach: a refused answer still attaches", find: "\tif (!sent) return;\n", replace: "" },
		{
			name: "attach: the client joins before the replay is sent",
			find: "\tfor (const frame of replay) client.send(frame);\n\tlive.viewers.add(client);\n",
			replace: "\tlive.viewers.add(client);\n\tfor (const frame of replay) client.send(frame);\n",
			equivalent:
				"nothing awaits between the two, so no event can be published in between: the frames leave in the same order",
		},
		{ name: "attach: the idle close is not cancelled", find: "\tctx.hub.reviewIdle(live);\n}", replace: "}" },
		{
			name: "detach: the client stays a viewer",
			find: '\t\tctx.hub.leave(live, client);\n\t\trespond({ type: "session.detach.result"',
			replace: '\t\trespond({ type: "session.detach.result"',
		},
		{ name: "detach: the client keeps the session", find: "\t\tclient.forget(live);\n", replace: "" },
	]),
	...mutantsOf("core/results.ts", [
		{ name: "attach: a missing session is internal", find: 'code === "not_found"', replace: 'code === "never"' },
	]),
	...mutantsOf("core/interaction-desk.ts", [
		{
			name: "desk: answers are not checked",
			find: 'if (problem !== undefined) return rejected("invalid_input", problem);',
			replace: "",
		},
		{
			name: "desk: every answer goes",
			find: "if (live.claims.has(id)) return rejected",
			replace: "if (false) return rejected",
		},
		{
			name: "desk: a refused answer keeps its claim",
			find: 'if (result.status === "rejected") live.claims.delete(id);',
			replace: "",
		},
		{
			name: "desk: a thrown answer keeps its claim",
			find: "\t\t\tlive.claims.delete(id);\n\t\t\tthrow error;",
			replace: "\t\t\tthrow error;",
		},
		{
			name: "desk: resolutions are forgotten",
			find: "this.resolved.set(sessionScopedKey(live.ref, event.interactionId), true);",
			replace: "",
		},
		{
			name: "desk: a resolution keeps its claim",
			find: "\t\tlive.claims.delete(event.interactionId);\n",
			replace: "",
			equivalent:
				"memory only: a resolved interaction is no longer pending, so an answer to it is `stale` before any claim is looked at",
		},
	]),
	...mutantsOf("core/prompt-ledger.ts", [
		{
			name: "ledger: the journal is not loaded",
			find: "for (const entry of journal?.load() ?? []) {",
			replace: "for (const entry of []) {",
		},
		{ name: "ledger: repeats in flight are not shared", find: "if (pending) return pending;", replace: "" },
		{ name: "ledger: an accepted prompt is forgotten", find: "if (known) return Promise.resolve(known);", replace: "" },
		{
			name: "ledger: a rejection is remembered",
			find: 'if (result.status === "accepted") this.remember(session, input, result);',
			replace: "this.remember(session, input, result as never);",
		},
		{
			name: "ledger: the journal is not written",
			find: "this.journal?.append({ session, clientRequestId: input.clientRequestId, result });",
			replace: "",
		},
	]),
	...mutantsOf("core/session-key.ts", [
		{
			name: "keys: joined ambiguously",
			find: "return JSON.stringify([ref.backend, ref.sessionId, id]);",
			replace: 'return [ref.backend, ref.sessionId, id].join(":");',
		},
		{
			name: "keys: log labels unquoted",
			find: "return JSON.stringify(sessionKey(ref));",
			replace: "return sessionKey(ref);",
		},
	]),
	...mutantsOf("core/same-state.ts", [
		{
			name: "same-state: key order counts",
			find: "? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))",
			replace: "? value",
		},
	]),
	...mutantsOf("core/catalog-feed.ts", [
		{ name: "catalog: invalid news is sent", find: "\t\tif (!checked.success) {\n", replace: "\t\tif (false) {\n" },
		{
			name: "catalog: news reaches clients without hello",
			find: "if (client.negotiated) client.send(frame);",
			replace: "client.send(frame);",
		},
		{
			name: "catalog: a deleted session's stream goes on",
			find: "\t\t\tthis.hub.remove(enriched.session);\n",
			replace: "",
		},
		{
			name: "catalog: a failure throws into the adapter",
			find: "} catch (error) {",
			replace: "} catch (error) { throw error;",
			equivalent:
				"nothing in `fanOut` throws (the schema check, the fit, `CoreClient.send` and `SessionHub.remove` all contain their failures); the catch holds contract §5 rule 13 by construction",
		},
	]),
	...mutantsOf("core/paged-read.ts", [
		{
			name: "paging: a page too large is sent",
			find: "if (bytes <= maxFrameBytes || current === 1) return message;",
			replace: "return message;",
		},
	]),
];
