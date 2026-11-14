/** Adapter README D4, D5: the options of every host, asserted from what the SDK was handed. */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { FakeQuery } from "../helpers/fake-query";
import { idle, init, running } from "./helpers/frames";
import { type FakeRig, fakeRig } from "./helpers/rig";
import { standInCatalogue } from "./helpers/stand-ins";

const dirs: string[] = [];
const sessionId = crypto.randomUUID();

function tempDir(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "cc-live-")));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function started(rig: FakeRig) {
	const live = await rig.openNew(tempDir());
	const call = rig.sdk.started[0];
	if (!call) throw new Error("no query was started");
	return { live, call, options: call.options };
}

describe("the options of a new host", () => {
	test("are the host options, with a session id of ours and an open iterable for a prompt", async () => {
		const rig = fakeRig([new FakeQuery()], { uid: 501 });
		const { call, options, live } = await started(rig);
		expect(typeof call.prompt).not.toBe("string");
		expect(Symbol.asyncIterator in Object(call.prompt)).toBe(true);
		expect(options).toMatchObject({
			permissionMode: "default",
			includePartialMessages: true,
			forwardSubagentText: true,
			agentProgressSummaries: true,
			allowDangerouslySkipPermissions: true,
			systemPrompt: { type: "preset", preset: "claude_code" },
			pathToClaudeCodeExecutable: "/fake/claude",
			sessionId: live.ref.sessionId,
		});
		expect(options.canUseTool).toBeFunction();
		expect(options.onElicitation).toBeFunction();
		expect(options.resume).toBeUndefined();
		await rig.dispose();
	});

	test("never ask the CLI to skip its prompts, hide dialogs by omission, forget the session, or narrow the settings", async () => {
		const rig = fakeRig([new FakeQuery()]);
		const { options } = await started(rig);
		for (const absent of [
			"supportedDialogKinds",
			"onUserDialog",
			"permissionPrompts",
			"persistSession",
			"settingSources",
			"perTaskStopAffordance",
			"continue",
			"forkSession",
			"abortController",
		] as const) {
			expect(options[absent]).toBeUndefined();
		}
		await rig.dispose();
	});

	test("as root outside a sandbox leave the bypass flag out, which would stop the CLI at startup", async () => {
		const root = fakeRig([new FakeQuery()], { uid: 0 });
		expect((await started(root)).options.allowDangerouslySkipPermissions).toBeUndefined();
		await root.dispose();
		const user = fakeRig([new FakeQuery()], { uid: 501 });
		expect((await started(user)).options.allowDangerouslySkipPermissions).toBe(true);
		await user.dispose();
	});

	test("carry the CLI's environment, which the SDK takes whole", async () => {
		const rig = fakeRig([new FakeQuery()]);
		const { options } = await started(rig);
		expect(options.env).toMatchObject({
			PATH: "/usr/bin",
			CLAUDE_AGENT_SDK_CLIENT_APP: "broski/fake-test",
			CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
			CLAUDE_CODE_STARTUP_FAILURE_RESULTS: "1",
		});
		expect(options.env?.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
		await rig.dispose();
	});

	test("start the model and the effort a person named, and the mode asked for", async () => {
		const rig = fakeRig([new FakeQuery()]);
		const live = await rig.openNew(tempDir(), {
			modelId: "sonnet",
			thinking: "high",
			modes: [{ axis: "permissions", value: "plan" }],
		});
		const options = rig.sdk.started[0]?.options;
		expect(options).toMatchObject({ model: "sonnet", effort: "high", permissionMode: "plan" });
		expect(live.initial).toMatchObject({ modelId: "sonnet", thinking: "high" });
		await rig.dispose();
	});

	test("leave the model to the CLI when none was named", async () => {
		const rig = fakeRig([new FakeQuery()]);
		const { options } = await started(rig);
		expect(options.model).toBeUndefined();
		expect(options.effort).toBeUndefined();
		await rig.dispose();
	});

	test("fail as a value when no binary was found, and start nothing", async () => {
		const rig = fakeRig([new FakeQuery()], { cli: false });
		const refused = await rig.live.open({ kind: "new", options: { cwd: tempDir() } }, { emit: () => undefined });
		expect(refused).toMatchObject({ status: "rejected", rejection: { code: "backend_error" } });
		expect(rig.sdk.started).toEqual([]);
		await rig.dispose();
	});
});

describe("the options of a resumed host", () => {
	async function existing(rig: () => FakeRig) {
		const dir = tempDir();
		const made = rig();
		const stored = { sessionId, summary: "x", lastModified: 1, cwd: dir };
		made.sdk.getSessionInfo = async () => stored;
		return { made, dir };
	}

	test("resume the session and name no session id", async () => {
		const { made } = await existing(() => fakeRig([new FakeQuery()]));
		const live = await made.openExisting({ backend: "claude-code", sessionId });
		const options = made.sdk.started[0]?.options;
		expect(options).toMatchObject({ resume: sessionId, permissionMode: "default" });
		expect(options?.sessionId).toBeUndefined();
		expect(options?.model).toBeUndefined();
		expect(live.initial.modes).toEqual([{ axis: "permissions", value: "default" }]);
		await made.dispose();
	});

	test("take the transcript's newest entry as the cut of the first run", async () => {
		const { made } = await existing(() => fakeRig([new FakeQuery()]));
		const entry: SessionMessage = JSON.parse(
			JSON.stringify({ type: "user", uuid: "11111111-1111-4111-8111-111111111111" }),
		);
		made.sdk.getSessionMessages = async () => [entry];
		const live = await made.openExisting({ backend: "claude-code", sessionId });
		await live.control.prompt({
			clientRequestId: crypto.randomUUID(),
			mode: "start",
			text: "go",
			attachments: [],
		});
		expect(made.store.rows.find((row) => row.status === "running")?.cut).toBe(entry.uuid);
		await made.dispose();
	});

	test("a restarted host resumes once the CLI wrote the session, and creates it again if it never did", async () => {
		const dir = tempDir();
		const never = new FakeQuery();
		const wrote = new FakeQuery();
		const rig = fakeRig([never, wrote, new FakeQuery()]);
		const prompt = {
			clientRequestId: crypto.randomUUID(),
			mode: "start" as const,
			text: "go",
			attachments: [],
		};
		const live = await rig.openNew(dir);
		never.end();
		await Bun.sleep(20);
		await live.control.prompt(prompt);
		expect(rig.sdk.started[1]?.options).toMatchObject({ sessionId: live.ref.sessionId });
		expect(rig.sdk.started[1]?.options.resume).toBeUndefined();
		wrote.push(running(), init(), idle());
		await Bun.sleep(20);
		wrote.end();
		await Bun.sleep(20);
		await live.control.prompt({ ...prompt, clientRequestId: crypto.randomUUID() });
		expect(rig.sdk.started[2]?.options).toMatchObject({ resume: live.ref.sessionId });
		expect(rig.sdk.started[2]?.options.sessionId).toBeUndefined();
		await rig.dispose();
	});

	test("a restarted host resumes a session found on disk even when no init was seen before the CLI ended", async () => {
		const dir = tempDir();
		const first = new FakeQuery();
		const rig = fakeRig([first, new FakeQuery()]);
		const live = await rig.openNew(dir);
		rig.sdk.getSessionInfo = async () => ({ sessionId: live.ref.sessionId, summary: "x", lastModified: 1, cwd: dir });
		first.end();
		await Bun.sleep(20);
		await live.control.prompt({
			clientRequestId: crypto.randomUUID(),
			mode: "start",
			text: "go",
			attachments: [],
		});
		expect(rig.sdk.started[1]?.options).toMatchObject({ resume: live.ref.sessionId });
		expect(rig.sdk.started[1]?.options.sessionId).toBeUndefined();
		await rig.dispose();
	});
});

describe("the model of a session that exists", () => {
	async function existing(recorded: string, wires: Record<string, string>) {
		const dir = tempDir();
		const query = new FakeQuery({ applyFlagSettings: async () => undefined });
		const rig = fakeRig([query], { catalogue: standInCatalogue(wires) });
		rig.sdk.getSessionInfo = async () => ({ sessionId, summary: "x", lastModified: 1, cwd: dir });
		rig.store.known.set(sessionId, { cwd: dir, modelId: recorded });
		const live = await rig.openExisting({ backend: "claude-code", sessionId });
		return { rig, live };
	}

	test("is shown by its listed id when the transcript recorded a wire id", async () => {
		const { rig, live } = await existing("claude-opus-5-5", { "claude-opus-5-5": "opus" });
		expect(live.initial.modelId).toBe("opus");
		await rig.dispose();
	});

	test("is kept as recorded when no listed model matches, and a thinking level is checked against the default model", async () => {
		const { rig, live } = await existing("claude-made-up-9", {});
		expect(live.initial.modelId).toBe("claude-made-up-9");
		expect((await live.control.setThinking("high")).status).toBe("accepted");
		expect(await live.control.setThinking("nonsense")).toMatchObject({
			status: "rejected",
			rejection: { code: "invalid_input" },
		});
		await rig.dispose();
	});
});

describe("ids that are not sessions", () => {
	test("are not_found for a session", async () => {
		const rig = fakeRig([]);
		const other = { emit: () => undefined };
		const notFound = { status: "rejected", rejection: { code: "not_found" } };
		for (const id of ["../etc/passwd", "", "not-a-uuid", `${"a".repeat(300)}`]) {
			expect(
				await rig.live.open({ kind: "existing", session: { backend: "claude-code", sessionId: id } }, other),
			).toMatchObject(notFound);
		}
		expect(rig.sdk.started).toEqual([]);
		await rig.dispose();
	});
});
