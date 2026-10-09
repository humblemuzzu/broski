import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { AgentEvent } from "@earendil-works/pi-durable";
import { PiDurableHarnessHost, PiDurableModelRequiredError } from "../../connectors/pi-durable/harness-host";
import { type PiDurablePermissionRequest, PiDurablePermissions } from "../../connectors/pi-durable/permissions";
import { PI_DURABLE_LOCK_FILE } from "../../connectors/pi-durable/storage-lock";

const faux = fauxProvider({
	models: [
		{ id: "faux-1", name: "Faux One" },
		{ id: "faux-2", name: "Faux Two" },
	],
});
const models = createModels();
models.setProvider(faux.provider);

const DEFAULT_MODEL = { provider: "faux", modelId: "faux-1" };

type Harness = {
	host: PiDurableHarnessHost;
	root: string;
	projectDir: string;
	permissions: PiDurablePermissions;
	requests: PiDurablePermissionRequest[];
	sessionId: string;
};

async function createHarness(options: { idleTimeoutMs?: number; withModel?: boolean } = {}): Promise<Harness> {
	const root = mkdtempSync(join(tmpdir(), "pi-durable-host-"));
	const projectDir = mkdtempSync(join(tmpdir(), "pi-durable-project-"));
	const requests: PiDurablePermissionRequest[] = [];
	const permissions = new PiDurablePermissions({ onRequest: (request) => requests.push(request) });
	const host = new PiDurableHarnessHost({
		models,
		root,
		permissions,
		...(options.withModel === false ? {} : { defaultModel: DEFAULT_MODEL }),
		...(options.idleTimeoutMs !== undefined ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
	});
	const session = await host.store.create({ cwd: projectDir, model: DEFAULT_MODEL });
	return { host, root, projectDir, permissions, requests, sessionId: session.id };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, label: string, timeoutMs = 15_000): Promise<void> {
	const started = Date.now();
	while (!(await predicate())) {
		if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

async function assistantText(harness: Harness): Promise<string> {
	const page = await harness.host.transcript(harness.sessionId);
	return page.entries
		.filter((entry) => entry.kind === "pi.assistant")
		.flatMap((entry) => entry.model ?? [])
		.flatMap((message) => (message.role === "assistant" ? message.content : []))
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("");
}

async function toolResults(harness: Harness) {
	const page = await harness.host.transcript(harness.sessionId);
	return page.entries
		.filter((entry) => entry.kind === "pi.tool-result")
		.flatMap((entry) => entry.model ?? [])
		.filter((message) => message.role === "toolResult");
}

function userEntryCount(entries: { kind: string }[]): number {
	return entries.filter((entry) => entry.kind === "pi.user").length;
}

describe("pi-durable harness host", () => {
	test("runs a turn through an approved permission and finishes the transcript", async () => {
		const harness = await createHarness();
		try {
			const opened = await harness.host.open(harness.sessionId);
			expect(opened.model).toEqual(DEFAULT_MODEL);
			expect(opened.interrupted).toEqual({ tasks: [], submissions: [] });

			const events: AgentEvent[] = [];
			const unsubscribe = await harness.host.watch(harness.sessionId, (batch) => events.push(...batch));
			expect(events.length).toBe(1);
			expect(events[0]?.type).toBe("snapshot");

			faux.setResponses([
				fauxAssistantMessage([fauxToolCall("bash", { command: "echo approved > out.txt" }, { id: "call-approve" })], {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("DONE.", { stopReason: "stop" }),
			]);

			const submissionId = await harness.host.send(harness.sessionId, {
				content: "write the file",
				requestId: "req-approve",
			});
			expect(typeof submissionId).toBe("number");

			await waitFor(() => harness.permissions.pendingFor(harness.sessionId).length > 0, "a permission request");
			const request = harness.requests[0];
			expect(request?.toolName).toBe("bash");
			expect(request?.requestId).toBe(`${harness.sessionId}:call-approve`);
			expect(request?.title).toBe("Run: echo approved > out.txt");
			expect(request?.input).toEqual({ command: "echo approved > out.txt" });
			expect(harness.permissions.resolvePermission(`${harness.sessionId}:unknown`, { allow: true })).toBe(false);
			expect(harness.permissions.resolvePermission(request?.requestId ?? "", { allow: true })).toBe(true);
			expect(harness.permissions.pendingFor(harness.sessionId)).toEqual([]);

			await waitFor(async () => (await assistantText(harness)).includes("DONE."), "the answer");
			expect(readFileSync(join(harness.projectDir, "out.txt"), "utf8")).toBe("approved\n");
			expect((await toolResults(harness)).map((message) => message.isError)).toEqual([false]);
			expect(events.some((event) => event.type === "tool_execution_end")).toBe(true);
			expect(events.some((event) => event.type === "run_end")).toBe(true);

			await unsubscribe();
			await unsubscribe();
		} finally {
			await harness.host.closeAll();
		}
	});

	test("blocks a denied tool call and tells the model why", async () => {
		const harness = await createHarness();
		try {
			await harness.host.open(harness.sessionId);
			faux.setResponses([
				fauxAssistantMessage([fauxToolCall("write", { path: "out.txt", content: "PROCEED" }, { id: "call-deny" })], {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("DONE.", { stopReason: "stop" }),
			]);

			await harness.host.send(harness.sessionId, { content: "write the file", requestId: "req-deny" });
			await waitFor(() => harness.permissions.pendingFor(harness.sessionId).length > 0, "a permission request");
			const request = harness.requests[0];
			expect(request?.toolName).toBe("write");
			expect(harness.permissions.resolvePermission(request?.requestId ?? "", { allow: false, reason: "not now" })).toBe(
				true,
			);

			await waitFor(async () => (await assistantText(harness)).includes("DONE."), "the answer");
			const results = await toolResults(harness);
			expect(results.map((message) => message.isError)).toEqual([true]);
			expect(JSON.stringify(results[0]?.content)).toContain("Tool call blocked: not now");
			expect(existsSync(join(harness.projectDir, "out.txt"))).toBe(false);
		} finally {
			await harness.host.closeAll();
		}
	});

	test("treats a repeated requestId as exactly-once and queues a steer while busy", async () => {
		const harness = await createHarness();
		try {
			await harness.host.open(harness.sessionId);
			const events: AgentEvent[] = [];
			await harness.host.watch(harness.sessionId, (batch) => events.push(...batch));
			faux.setResponses([
				fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 5" }, { id: "call-busy" })], {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("OK", { stopReason: "stop" }),
			]);

			const first = await harness.host.send(harness.sessionId, { content: "run it", requestId: "req-once" });
			const duplicate = await harness.host.send(harness.sessionId, { content: "run it", requestId: "req-once" });
			expect(duplicate).toBe(first);

			await waitFor(() => harness.permissions.pendingFor(harness.sessionId).length > 0, "a permission request");
			harness.permissions.resolvePermission(harness.permissions.pendingFor(harness.sessionId)[0]?.requestId ?? "", {
				allow: true,
			});
			await waitFor(() => events.some((event) => event.type === "tool_execution_start"), "the tool start");

			const steer = await harness.host.send(harness.sessionId, {
				content: "also say STEERED",
				whenBusy: "steer",
				requestId: "req-steer",
			});
			expect(steer).not.toBe(first);
			await waitFor(
				() =>
					events.some((event) => event.type === "inbox_update" && event.items.some((item) => item.mode === "steer")),
				"the queued steer",
			);
			expect((await harness.host.inspect(harness.sessionId)).submissions.length).toBeGreaterThan(0);

			await harness.host.abort(harness.sessionId);
			await waitFor(async () => (await harness.host.inspect(harness.sessionId)).tasks.length === 0, "an idle harness");
			const page = await harness.host.transcript(harness.sessionId);
			expect(userEntryCount(page.entries)).toBe(1);
		} finally {
			await harness.host.closeAll();
		}
	});

	test("aborts a running tool and reports the aborted result", async () => {
		const harness = await createHarness();
		try {
			await harness.host.open(harness.sessionId);
			const events: AgentEvent[] = [];
			await harness.host.watch(harness.sessionId, (batch) => events.push(...batch));
			faux.setResponses([
				fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 30" }, { id: "call-abort" })], {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("OK", { stopReason: "stop" }),
			]);

			await harness.host.send(harness.sessionId, { content: "sleep", requestId: "req-abort" });
			await waitFor(() => harness.permissions.pendingFor(harness.sessionId).length > 0, "a permission request");
			harness.permissions.resolvePermission(harness.permissions.pendingFor(harness.sessionId)[0]?.requestId ?? "", {
				allow: true,
			});
			await waitFor(() => events.some((event) => event.type === "tool_execution_start"), "the tool start");

			const startedAt = Date.now();
			await harness.host.abort(harness.sessionId);
			expect(Date.now() - startedAt).toBeLessThan(5_000);
			expect((await harness.host.inspect(harness.sessionId)).tasks.length).toBe(0);

			await waitFor(async () => (await toolResults(harness)).length > 0, "the aborted tool result");
			const results = await toolResults(harness);
			expect(results[0]?.isError).toBe(true);
			expect(JSON.stringify(results[0]?.content)).toContain("was aborted");
		} finally {
			await harness.host.closeAll();
		}
	});

	test("reports interrupted work when the session is reopened after a crash", async () => {
		const harness = await createHarness();
		try {
			await harness.host.open(harness.sessionId);
			const events: AgentEvent[] = [];
			await harness.host.watch(harness.sessionId, (batch) => events.push(...batch));
			faux.setResponses([
				fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 30" }, { id: "call-crash" })], {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("DONE.", { stopReason: "stop" }),
			]);

			const submissionId = await harness.host.send(harness.sessionId, {
				content: "sleep then answer",
				requestId: "req-crash",
			});
			await waitFor(() => harness.permissions.pendingFor(harness.sessionId).length > 0, "a permission request");
			harness.permissions.resolvePermission(harness.permissions.pendingFor(harness.sessionId)[0]?.requestId ?? "", {
				allow: true,
			});
			await waitFor(() => events.some((event) => event.type === "tool_execution_start"), "the tool start");

			await harness.host.close(harness.sessionId);
			expect(harness.host.isOpen(harness.sessionId)).toBe(false);
			expect(existsSync(join(harness.root, harness.sessionId, PI_DURABLE_LOCK_FILE))).toBe(false);

			const reopened = await harness.host.open(harness.sessionId);
			expect(reopened.interrupted.tasks.map((task) => task.kind)).toContain("pi.tool");
			expect(reopened.interrupted.submissions.map((record) => record.status)).toContain("placed");

			const again = await harness.host.send(harness.sessionId, {
				content: "sleep then answer",
				requestId: "req-crash",
			});
			expect(again).toBe(submissionId);

			await waitFor(async () => (await assistantText(harness)).includes("DONE."), "the resumed answer");
			const results = await toolResults(harness);
			expect(results.map((message) => message.isError)).toEqual([true]);
			expect(JSON.stringify(results[0]?.content)).toContain("interrupted");
		} finally {
			await harness.host.closeAll();
		}
	});

	test("persists a model and thinking level configured on an open session", async () => {
		const harness = await createHarness();
		try {
			await harness.host.open(harness.sessionId);
			await harness.host.configure(harness.sessionId, {
				model: { provider: "faux", modelId: "faux-2" },
				thinkingLevel: "high",
			});

			const stored = await harness.host.store.read(harness.sessionId);
			expect(stored?.model).toEqual({ provider: "faux", modelId: "faux-2" });
			expect(stored?.thinkingLevel).toBe("high");

			const reopened = await harness.host.open(harness.sessionId);
			expect(reopened.model).toEqual({ provider: "faux", modelId: "faux-2" });
			expect(reopened.thinkingLevel).toBe("high");
		} finally {
			await harness.host.closeAll();
		}
	});

	test("refuses to open a session that has no model", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-durable-host-"));
		const projectDir = mkdtempSync(join(tmpdir(), "pi-durable-project-"));
		const host = new PiDurableHarnessHost({ models, root });
		const session = await host.store.create({ cwd: projectDir });

		await expect(host.open(session.id)).rejects.toBeInstanceOf(PiDurableModelRequiredError);
		expect(existsSync(join(root, session.id, PI_DURABLE_LOCK_FILE))).toBe(false);
	});

	test("idle-closes an unattended session and releases its lock", async () => {
		const harness = await createHarness({ idleTimeoutMs: 40 });
		try {
			await harness.host.open(harness.sessionId);
			await waitFor(() => !harness.host.isOpen(harness.sessionId), "the idle close", 5_000);
			expect(existsSync(join(harness.root, harness.sessionId, PI_DURABLE_LOCK_FILE))).toBe(false);

			await harness.host.open(harness.sessionId);
			expect(harness.host.isOpen(harness.sessionId)).toBe(true);
		} finally {
			await harness.host.closeAll();
		}
	});

	test("keeps an open session alive while a phone is watching", async () => {
		const harness = await createHarness({ idleTimeoutMs: 40 });
		try {
			await harness.host.open(harness.sessionId);
			const unsubscribe = await harness.host.watch(harness.sessionId, () => undefined);
			await new Promise((resolve) => setTimeout(resolve, 200));
			expect(harness.host.isOpen(harness.sessionId)).toBe(true);

			await unsubscribe();
			await waitFor(() => !harness.host.isOpen(harness.sessionId), "the idle close after detach", 5_000);
		} finally {
			await harness.host.closeAll();
		}
	});

	test("writes a session that a fresh host can list", async () => {
		const harness = await createHarness();
		try {
			writeFileSync(join(harness.projectDir, "AGENTS.md"), "# Project\n");
			await harness.host.open(harness.sessionId);
			const other = new PiDurableHarnessHost({ models, root: harness.root });
			const listed = await other.store.list();
			expect(listed.map((meta) => meta.id)).toEqual([harness.sessionId]);
			expect(listed[0]?.cwd).toBe(harness.projectDir);
			expect(other.isOpen(harness.sessionId)).toBe(false);
		} finally {
			await harness.host.closeAll();
		}
	});

	test("marks no provider as subscription-backed by default", async () => {
		const harness = await createHarness();
		try {
			expect(harness.host.isSubscription("anthropic")).toBe(false);
			expect(harness.host.permissions.pendingFor(harness.sessionId)).toEqual([]);
		} finally {
			await harness.host.closeAll();
		}
	});
});
