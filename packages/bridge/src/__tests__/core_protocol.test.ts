import { describe, expect, test } from "bun:test";
import { backendCapabilities, type ModelsListResult, PROTOCOL_VERSION, type TranscriptItem } from "../contract";
import { NO_METHODS } from "../contract/testing/fake-backend";
import { DEFAULT_IDLE_CLOSE_MS } from "../core/keep-open";
import { HELLO_FIRST } from "../core/results";
import { Gate } from "./helpers/core-adapters";
import { promptInput, quiesce, RIG_CWD, startCoreRig, TestClient } from "./helpers/core-rig";

describe("the core's protocol: handshake and validation", () => {
	test("hello agrees on the major version and names the bridge", async () => {
		const rig = await startCoreRig();
		const client = new TestClient(rig.core, "a");
		const answer = await client.request("hello", {
			protocol: { major: PROTOCOL_VERSION.major, minor: PROTOCOL_VERSION.minor + 3 },
			client: { name: "app", version: "9" },
		});
		expect(answer).toEqual({
			type: "hello.result",
			requestId: "a-0",
			protocol: PROTOCOL_VERSION,
			bridgeVersion: "0.0.0-test",
		});
		expect(client.violations).toEqual([]);
	});

	test("another major is refused, and the client stays unserved", async () => {
		const rig = await startCoreRig();
		const client = new TestClient(rig.core, "a");
		const answer = await client.request("hello", {
			protocol: { major: PROTOCOL_VERSION.major + 1, minor: 0 },
			client: { name: "app", version: "9" },
		});
		expect(answer.type).toBe("error");
		if (answer.type === "error") expect(answer.error.code).toBe("unsupported_version");
		const list = await client.request("backends.list", {});
		expect(list).toMatchObject({ type: "error", requestId: "a-1", error: { code: "invalid_message" } });
	});

	test("a hello with another major ends the talk: the client's sessions are let go and it gets no more news", async () => {
		const rig = await startCoreRig();
		const client = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await client.ok("session.attach", { session });
		const answer = await client.request("hello", {
			protocol: { major: PROTOCOL_VERSION.major + 1, minor: 0 },
			client: { name: "app", version: "10" },
		});
		expect(answer).toMatchObject({ error: { code: "unsupported_version" } });
		client.clear();
		rig.fake.fake.runExternally(session, "From the terminal.", [{ kind: "text", text: "Done there." }]);
		rig.fake.fake.seed({ cwd: RIG_CWD });
		await quiesce();
		expect(client.messages).toEqual([]);
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		expect(rig.opens.closed).toEqual([session.sessionId]);
	});

	test("an attach still opening when a hello of another major arrives is refused, and its client views nothing", async () => {
		const gate = new Gate<void>();
		const rig = await startCoreRig({
			adapt: (backend) => ({
				...backend,
				open: async (target, sink) => {
					await gate.hold();
					return backend.open(target, sink);
				},
			}),
		});
		const client = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const attaching = client.request("session.attach", { session });
		await gate.arrived();
		await client.request("hello", {
			protocol: { major: PROTOCOL_VERSION.major + 1, minor: 0 },
			client: { name: "app", version: "10" },
		});
		gate.pass();
		expect(await attaching).toMatchObject({ error: { code: "invalid_message", message: HELLO_FIRST } });
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		expect(rig.opens.closed).toEqual([session.sessionId]);
	});

	test("nothing but hello is served before hello, and no catalog news is sent either", async () => {
		const rig = await startCoreRig();
		const client = new TestClient(rig.core, "a");
		expect(await client.request("backends.list", {})).toMatchObject({
			type: "error",
			requestId: "a-0",
			error: { code: "invalid_message", message: expect.stringContaining("hello") },
		});
		rig.fake.fake.seed({ cwd: RIG_CWD });
		expect(client.catalog()).toEqual([]);
	});

	test("a frame or request that breaks the contract is invalid_message, with the requestId when it is readable", async () => {
		const rig = await startCoreRig();
		const client = await rig.client("a");
		client.clear();
		await client.sendFrame({ type: "contract" });
		await client.sendFrame({ type: "contract", message: { type: "no.such.request", requestId: "r1" } });
		await client.sendFrame({ type: "contract", message: { type: "backends.list", requestId: "r2", extra: true } });
		await client.sendFrame({ type: "contract", message: { type: "backends.list", requestId: 7 } });
		await client.sendFrame({ type: "contract", message: { type: "backends.list", requestId: "r3" }, more: 1 });
		const errors = client.messages.map((message) =>
			message.type === "error" ? [message.requestId, message.error.code] : [message.type],
		);
		expect(errors).toEqual([
			[undefined, "invalid_message"],
			["r1", "invalid_message"],
			["r2", "invalid_message"],
			[undefined, "invalid_message"],
			[undefined, "invalid_message"],
		]);
		expect(client.violations).toEqual([]);
	});
});

describe("the core's protocol: backend-wide requests", () => {
	test("backends.list gives each registered backend with its derived capabilities", async () => {
		const rig = await startCoreRig({ fake: { methods: NO_METHODS } });
		const client = await rig.client("a");
		const answer = await client.ok("backends.list", {});
		expect(answer.backends).toEqual([{ id: "pi", capabilities: backendCapabilities(rig.fake) }]);
		expect(answer.backends[0]?.capabilities).toMatchObject({
			fork: false,
			rename: false,
			delete: false,
			archive: false,
		});
	});

	test("an unregistered backend is unknown_backend for every request that names one", async () => {
		const rig = await startCoreRig();
		const client = await rig.client("a");
		const session = { backend: "claude-code" as const, sessionId: "s" };
		const answers = [
			await client.request("backend.status", { backend: "claude-code" }),
			await client.request("models.list", { backend: "claude-code" }),
			await client.request("sessions.list", { backend: "claude-code", query: { archived: false }, page: { limit: 5 } }),
			await client.request("session.get", { session }),
			await client.request("session.attach", { session }),
			await client.request("prompt", {
				session,
				input: { clientRequestId: crypto.randomUUID(), mode: "start", text: "x", attachments: [], mentions: [] },
			}),
			await client.request("backend.call", {
				call: { backend: "claude-code", op: { kind: "rewind_files", sessionId: "s", userItemId: "i", dryRun: true } },
			}),
		];
		expect(answers.map((answer) => (answer.type === "error" ? answer.error.code : answer.type))).toEqual(
			Array(answers.length).fill("unknown_backend"),
		);
		expect(rig.log.errors).toEqual([]);
	});

	test("backend.status is the adapter's, and an adapter whose status() throws becomes an unusable status", async () => {
		const rig = await startCoreRig();
		const client = await rig.client("a");
		expect((await client.ok("backend.status", { backend: "pi" })).status).toMatchObject({ usable: true, issues: [] });
		const brokenRig = await startCoreRig({
			adapt: (backend) => ({
				...backend,
				status: async () => {
					throw new Error("boom");
				},
			}),
		});
		const broken = await (await brokenRig.client("a")).ok("backend.status", { backend: "pi" });
		expect(broken.status).toMatchObject({ usable: false, issues: [{ severity: "error" }] });
		expect(brokenRig.log.errors.some((line) => line.includes("status() threw"))).toBe(true);
	});

	test("models, commands and modes come from the adapter for an allowed directory, and a refused one never reaches it", async () => {
		const asked: string[] = [];
		const rig = await startCoreRig({
			core: {
				directories: async (path) => {
					asked.push(path);
					return path.startsWith("/fake") ? `${path}/real` : undefined;
				},
			},
		});
		const client = await rig.client("a");
		const models = await client.ok("models.list", { backend: "pi", cwd: RIG_CWD });
		expect(models.result.status).toBe("accepted");
		const commands = await client.ok("commands.list", { backend: "pi" });
		expect(commands.result.status).toBe("accepted");
		const modes = await client.ok("modes.list", { backend: "pi", cwd: "/etc" });
		expect(modes.result).toEqual({
			status: "rejected",
			rejection: { code: "invalid_input", message: "/etc is not a directory this bridge serves" },
		});
		const created = await client.ok("session.create", { backend: "pi", options: { cwd: "/elsewhere" } });
		expect(created.result.status).toBe("rejected");
		expect(asked).toEqual([RIG_CWD, "/etc", "/elsewhere"]);
	});

	test("the directory the policy gives back is the one the adapter sees", async () => {
		const rig = await startCoreRig({ core: { directories: async () => "/canonical" } });
		const client = await rig.client("a");
		rig.fake.fake.seed({ cwd: "/canonical" });
		rig.fake.fake.seed({ cwd: RIG_CWD });
		const listed = await client.ok("sessions.list", {
			backend: "pi",
			query: { archived: false, cwd: "/alias" },
			page: { limit: 10 },
		});
		expect(listed.result.status === "accepted" && listed.result.page.items.map((row) => row.cwd)).toEqual([
			"/canonical",
		]);
	});
});

describe("the core's protocol: sessions without a live stream", () => {
	test("sessions list in pages, newest first, and read by ref", async () => {
		const rig = await startCoreRig();
		const client = await rig.client("a");
		const seeded = [0, 1, 2].map((index) => rig.fake.fake.seed({ cwd: RIG_CWD, title: `S${index}` }));
		const first = await client.ok("sessions.list", { backend: "pi", query: { archived: false }, page: { limit: 2 } });
		if (first.result.status !== "accepted") throw new Error("listing failed");
		const cursor = first.result.page.nextCursor;
		expect(cursor).toBeString();
		const second = await client.ok("sessions.list", {
			backend: "pi",
			query: { archived: false },
			page: { limit: 2, ...(cursor !== undefined && { cursor }) },
		});
		if (second.result.status !== "accepted") throw new Error("listing failed");
		const ids = [...first.result.page.items, ...second.result.page.items].map((row) => row.session.sessionId);
		expect(ids).toEqual(seeded.map((ref) => ref.sessionId).reverse());
		const [newest] = seeded.slice(-1);
		if (!newest) throw new Error("no session seeded");
		expect((await client.ok("session.get", { session: newest })).result).toMatchObject({
			status: "accepted",
			summary: { title: { text: "S2" } },
		});
	});

	test("rename, archive, fork and delete reach the adapter and show in every client's catalog", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const b = await rig.client("b");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		b.clear();
		expect((await a.ok("session.rename", { session, title: "Renamed" })).result).toEqual({ status: "accepted" });
		expect((await a.ok("session.archive", { session, archived: true })).result).toEqual({ status: "accepted" });
		const fork = await a.ok("session.fork", { session });
		expect(fork.result.status).toBe("accepted");
		expect((await a.ok("session.delete", { session })).result).toEqual({ status: "accepted" });
		expect(b.catalog().map((message) => message.event.type)).toEqual([
			"session_updated",
			"session_updated",
			"session_updated",
			"session_removed",
		]);
		expect(b.catalog().every((message) => message.backend === "pi")).toBe(true);
	});

	test("a backend without the optional methods answers unsupported", async () => {
		const rig = await startCoreRig({ fake: { methods: NO_METHODS } });
		const client = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const results = [
			(await client.ok("session.rename", { session, title: "x" })).result,
			(await client.ok("session.archive", { session, archived: true })).result,
			(await client.ok("session.delete", { session })).result,
			(await client.ok("session.fork", { session })).result,
			(
				await client.ok("backend.call", {
					call: {
						backend: "pi",
						op: { kind: "navigate_tree", sessionId: session.sessionId, itemId: "i", summarize: false },
					},
				})
			).result,
		];
		expect(results.map((result) => result.status === "rejected" && result.rejection.code)).toEqual(
			Array(results.length).fill("unsupported"),
		);
	});

	test("transcript pages, attachments and a history-rewriting op", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const b = await rig.client("b");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const page = await a.ok("transcript.read", { session, page: { limit: 10 } });
		if (page.result.status !== "accepted") throw new Error("no transcript");
		expect(page.result.page.items.map((item) => item.kind)).toEqual(["run_boundary", "block", "user_message"]);
		const missing = await a.ok("attachment.read", { session, attachmentId: "nope" });
		expect(missing.result).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
		const [prompt] = page.result.page.items.slice(-1);
		if (!prompt) throw new Error("no prompt");
		b.clear();
		const call = await a.ok("backend.call", {
			call: {
				backend: "pi",
				op: { kind: "navigate_tree", sessionId: session.sessionId, itemId: prompt.id, summarize: false },
			},
		});
		expect(call.result).toEqual({ status: "accepted", result: { kind: "navigate_tree" } });
		expect(b.catalog().map((message) => message.event)).toEqual([{ type: "transcript_invalidated", session }]);
	});

	test("a page larger than the link is read again smaller, whole items and all", async () => {
		const rig = await startCoreRig({ core: { maxFrameBytes: 64 * 1024 } });
		const client = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await client.ok("session.attach", { session });
		for (let run = 0; run < 8; run++) {
			rig.fake.fake.script(session, [{ kind: "text", text: `${run}:${"t".repeat(20_000)}` }]);
			await client.ok("prompt", { session, input: promptInput(`Run ${run}`) });
			await quiesce();
		}
		const items: TranscriptItem[] = [];
		let cursor: string | undefined;
		let pages = 0;
		do {
			const read = await client.ok("transcript.read", {
				session,
				page: { limit: 200, ...(cursor !== undefined && { cursor }) },
			});
			if (read.result.status !== "accepted") throw new Error("the read failed");
			items.push(...read.result.page.items);
			cursor = read.result.page.nextCursor;
			pages += 1;
		} while (cursor !== undefined);
		expect(pages).toBeGreaterThan(2);
		const replies = items.flatMap((item) =>
			item.kind === "block" && item.text.includes("t".repeat(100)) ? [item.text] : [],
		);
		expect(replies.map((text) => text.length).sort()).toEqual(Array(8).fill(20_002));
		expect(Math.max(...client.frameSizes)).toBeLessThanOrEqual(64 * 1024);
	});

	test("catalog news larger than the link is shortened, and news that cannot fit is dropped and logged", async () => {
		const rig = await startCoreRig({ core: { maxFrameBytes: 64 * 1024 } });
		const client = await rig.client("a");
		client.clear();
		const issue = { severity: "warning" as const, message: "w".repeat(100_000) };
		const status = { installed: true, auth: "signed_in" as const, usable: true };
		rig.host.catalog.emit({ type: "status_changed", status: { ...status, issues: [issue] } });
		rig.host.catalog.emit({ type: "status_changed", status: { ...status, issues: Array(1_000).fill(issue) } });
		const news = client.catalog();
		expect(news).toHaveLength(1);
		const [shortened] = news;
		expect(shortened?.event.type === "status_changed" && shortened.event.status.issues[0]?.message.length).toBeLessThan(
			issue.message.length,
		);
		expect(rig.log.errors.some((line) => line.includes("too large for the link"))).toBe(true);
	});

	test("catalog news goes to every client that said hello, attached or not", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const b = await rig.client("b");
		const silent = new TestClient(rig.core, "silent");
		a.clear();
		b.clear();
		rig.fake.fake.seed({ cwd: RIG_CWD });
		await quiesce();
		expect(a.catalog()).toHaveLength(1);
		expect(b.catalog()).toEqual(a.catalog());
		expect(silent.messages).toEqual([]);
	});

	test("a closed client is sent nothing more, not even the answer to a request it sent before", async () => {
		const gate = new Gate<ModelsListResult>();
		const rig = await startCoreRig({ adapt: (backend) => ({ ...backend, listModels: () => gate.hold() }) });
		const a = await rig.client("a");
		const asking = a.sendFrame({ type: "contract", message: { type: "models.list", requestId: "m", backend: "pi" } });
		await gate.arrived();
		a.close();
		a.clear();
		rig.fake.fake.seed({ cwd: RIG_CWD });
		gate.pass({ status: "accepted", models: [] });
		await asking;
		expect(a.messages).toEqual([]);
	});
});
