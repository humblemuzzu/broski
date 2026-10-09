import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { PiDurableHarnessHost } from "../../connectors/pi-durable/harness-host";
import {
	defaultPiDurablePermissionPolicy,
	type PiDurablePermissionRequest,
	PiDurablePermissions,
} from "../../connectors/pi-durable/permissions";
import { closePiDurableSessionRuntime, openPiDurableSessionRuntime } from "../../connectors/pi-durable/session-runtime";
import { createPiDurableSearchTools } from "../../connectors/pi-durable/tools";

const faux = fauxProvider({ models: [{ id: "faux-1", name: "Faux One" }] });
const models = createModels();
models.setProvider(faux.provider);

const DEFAULT_MODEL = { provider: "faux", modelId: "faux-1" };

function createProjectDir(): string {
	const projectDir = mkdtempSync(join(tmpdir(), "pi-durable-tools-project-"));
	mkdirSync(join(projectDir, "sub"));
	writeFileSync(join(projectDir, "a.ts"), "export const greeting = 'hello';\n");
	writeFileSync(join(projectDir, "sub", "c.ts"), "const greeting = 'world';\n");
	return projectDir;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, label: string, timeoutMs = 15_000): Promise<void> {
	const started = Date.now();
	while (!(await predicate())) {
		if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

async function offeredToolNames(directory: string, cwd: string): Promise<string[]> {
	const runtime = await openPiDurableSessionRuntime({
		sessionId: "search-session",
		directory,
		cwd,
		models,
		agent: { model: DEFAULT_MODEL, cwd },
		context: BACKGROUND_CONTEXT,
	});
	try {
		const agent = await runtime.conversation.agent(BACKGROUND_CONTEXT);
		return agent.tools.map((tool) => tool.name);
	} finally {
		await closePiDurableSessionRuntime(runtime, BACKGROUND_CONTEXT);
	}
}

async function assistantText(host: PiDurableHarnessHost, sessionId: string): Promise<string> {
	const page = await host.transcript(sessionId);
	return page.entries
		.filter((entry) => entry.kind === "pi.assistant")
		.flatMap((entry) => entry.model ?? [])
		.flatMap((message) => (message.role === "assistant" ? message.content : []))
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("");
}

async function toolResultTexts(host: PiDurableHarnessHost, sessionId: string): Promise<string[]> {
	const page = await host.transcript(sessionId);
	return page.entries
		.filter((entry) => entry.kind === "pi.tool-result")
		.flatMap((entry) => entry.model ?? [])
		.filter((message) => message.role === "toolResult")
		.map((message) => message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""));
}

describe("pi-durable read-only search tools", () => {
	test("are replay-safe and auto-allowed by the permission policy", () => {
		const tools = createPiDurableSearchTools(createProjectDir());
		expect(tools.map((tool) => [tool.name, tool.replay])).toEqual([
			["ls", "safe"],
			["find", "safe"],
			["grep", "safe"],
		]);
		const outcomes = tools.map((tool) =>
			defaultPiDurablePermissionPolicy({ sessionId: "session", toolName: tool.name, input: {} }),
		);
		expect(outcomes).toEqual(["allow", "allow", "allow"]);
	});

	test("are offered to a new session and to a reopened one", async () => {
		const directory = mkdtempSync(join(tmpdir(), "pi-durable-tools-"));
		const projectDir = createProjectDir();
		const offered = await offeredToolNames(directory, projectDir);
		expect(offered).toEqual(["read", "write", "edit", "bash", "ls", "find", "grep"]);
		expect(await offeredToolNames(directory, projectDir)).toEqual(offered);
	});

	test("run without a permission request while bash still asks", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-durable-search-host-"));
		const projectDir = createProjectDir();
		const requests: PiDurablePermissionRequest[] = [];
		const permissions = new PiDurablePermissions({ onRequest: (request) => requests.push(request) });
		const host = new PiDurableHarnessHost({ models, root, permissions, defaultModel: DEFAULT_MODEL });
		const session = await host.store.create({ cwd: projectDir, model: DEFAULT_MODEL });
		try {
			await host.open(session.id);
			faux.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("ls", { path: "." }, { id: "call-ls" }),
						fauxToolCall("find", { pattern: "*.ts" }, { id: "call-find" }),
						fauxToolCall("grep", { pattern: "greeting" }, { id: "call-grep" }),
					],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("SEARCHED.", { stopReason: "stop" }),
			]);

			await host.send(session.id, { content: "look around", requestId: "req-search" });
			await waitFor(async () => (await assistantText(host, session.id)).includes("SEARCHED."), "the search turn");
			expect(requests).toEqual([]);

			const texts = await toolResultTexts(host, session.id);
			expect(texts).toContain("a.ts\nsub/");
			expect(texts).toContain("a.ts\nsub/c.ts");
			expect(texts).toContain("a.ts:1: export const greeting = 'hello';\nsub/c.ts:1: const greeting = 'world';");

			faux.setResponses([
				fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" }, { id: "call-bash" })], {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("RAN.", { stopReason: "stop" }),
			]);
			await host.send(session.id, { content: "run it", requestId: "req-bash" });
			await waitFor(() => requests.length > 0, "the bash permission request");
			expect(requests.map((request) => request.toolName)).toEqual(["bash"]);
			expect(permissions.resolvePermission(requests[0]?.requestId ?? "", { allow: true })).toBe(true);
			await waitFor(async () => (await assistantText(host, session.id)).includes("RAN."), "the bash turn");
			expect(await toolResultTexts(host, session.id)).toHaveLength(4);
		} finally {
			await host.closeAll();
		}
	});
});
