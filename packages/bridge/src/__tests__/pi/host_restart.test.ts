/**
 * A hosted session's `pi` outlives its bridge (`backends/pi/holder/`): a bridge SIGKILLed mid-tool, as the daemon kills
 * one, leaves the run going, and the next bridge takes it over with its prompt, its tool and its open ask, writing
 * nothing twice. A run that ends meanwhile is taken over idle, a second bridge takes a session from the first without
 * the first calling it a crash, and a holder directory nothing answers in is cleared without signalling anyone.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPiParts, piBackendOf } from "../../backends/pi/backend";
import { holderDirOf, metaOf, socketOf } from "../../backends/pi/holder/protocol";
import type { AgentEvent, SessionRef } from "../../contract";
import { SessionRecorder } from "../../contract/testing/conformance-harness";
import { validReply } from "../../contract/testing/example-replies";
import { eventually, isAlive } from "./helpers/holder-rig";
import { LiveRig } from "./helpers/live-rig";
import { answerTexts, holdingRun } from "./helpers/live-steps";
import { allItems } from "./helpers/paging";
import { HOLDER_COMMAND } from "./helpers/pi-world";
import { call, say } from "./helpers/scenarios";
import { messagesIn, readEntries, userTexts } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;
let bridge: BridgeProcess | undefined;

afterEach(async () => {
	bridge?.kill();
	bridge = undefined;
	await t?.dispose();
	t = undefined;
});

const BRIDGE_PROCESS = resolve(import.meta.dir, "helpers/bridge-process.ts");

/** The world's backend in a process of its own (`helpers/bridge-process.ts`), which the test kills as the daemon would. */
class BridgeProcess {
	readonly lines: Record<string, unknown>[] = [];
	private readonly child: ChildProcessWithoutNullStreams;

	constructor(rig: LiveRig) {
		const { world } = rig;
		const config = {
			cli: world.cliPath,
			agentDir: world.env.agentDir,
			hostDir: world.hostDir,
			holders: { root: world.holdersRoot, command: HOLDER_COMMAND },
			cwd: world.env.cwd,
		};
		this.child = spawn(process.execPath, [BRIDGE_PROCESS, JSON.stringify(config)], { env: process.env });
		let partial = "";
		this.child.stdout.setEncoding("utf8");
		this.child.stdout.on("data", (chunk: string) => {
			const parts = (partial + chunk).split("\n");
			partial = parts.pop() ?? "";
			for (const part of parts) this.lines.push(JSON.parse(part));
		});
	}

	get pid(): number {
		return this.child.pid ?? 0;
	}

	async open(modes?: unknown): Promise<string> {
		this.send({ op: "open", ...(modes !== undefined && { modes }) });
		return String((await this.next((line) => line.opened !== undefined)).opened);
	}

	async prompt(text: string): Promise<void> {
		this.send({ op: "prompt", text });
		await this.next((line) => line.prompted !== undefined);
	}

	event<T extends AgentEvent["type"]>(type: T): Promise<Extract<AgentEvent, { type: T }>> {
		const isType = (event: AgentEvent | undefined): event is Extract<AgentEvent, { type: T }> => event?.type === type;
		return this.next((line) => isType(line.event as AgentEvent | undefined)).then((line) => {
			const event = line.event as AgentEvent | undefined;
			if (!isType(event)) throw new Error(`no ${type}`);
			return event;
		});
	}

	/** As the daemon's supervisor ends a bridge: nothing of it runs another line. */
	async sigkill(): Promise<void> {
		const exited = new Promise((resolve) => this.child.once("exit", resolve));
		this.child.kill("SIGKILL");
		await exited;
	}

	kill(): void {
		this.child.kill("SIGKILL");
	}

	private send(command: unknown): void {
		this.child.stdin.write(`${JSON.stringify(command)}\n`);
	}

	private async next(match: (line: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
		await eventually(() => this.lines.some(match), "the bridge process", 15_000);
		const found = this.lines.find(match);
		if (found === undefined) throw new Error("unreachable");
		return found;
	}
}

function promptRecords(file: string): number {
	return readEntries(file).filter((entry) => entry.type === "custom" && entry.customType === "broski.prompt").length;
}

function toolResults(file: string): string[] {
	return messagesIn(file).flatMap(([role, text]) => (role === "toolResult" ? [text] : []));
}

describe("a bridge SIGKILLed while its session runs", () => {
	test("leaves the run going mid-tool; the next bridge shows it, and it finishes there with the answer", async () => {
		t = await LiveRig.create();
		bridge = new BridgeProcess(t);
		const sessionId = await bridge.open();
		t.router.replace(sessionId, [call("bash", { command: "sleep 2; echo slept" }), say("All done.")]);
		await bridge.prompt("Do the slow thing.");
		const sent = await bridge.event("user_message");
		await bridge.event("tool_started");
		await Bun.sleep(300);
		await bridge.sigkill();
		expect(t.world.sessionProcesses()).toBe(1);

		await t.rig.restart();
		const ref: SessionRef = { backend: "pi", sessionId };
		const reopened = await t.rig.open(ref);
		const run = reopened.initial.run;
		if (run === undefined) throw new Error("the run did not survive the bridge");
		expect(run.trigger).toBe("system");
		const prompt = run.items.find((item) => item.kind === "user_message");
		expect(prompt?.kind === "user_message" && [prompt.text, prompt.clientRequestId]).toEqual([
			"Do the slow thing.",
			sent.clientRequestId,
		]);
		const bash = run.items.find((item) => item.kind === "tool_call");
		expect(bash?.kind === "tool_call" && bash.name).toBe("bash");
		expect(run.items.some((item) => item.kind === "tool_result")).toBe(false);

		const finished = await reopened.waitFor("run_finished", (event) => event.runId === run.runId);
		expect(finished.outcome.kind).toBe("completed");
		expect(answerTexts(await allItems(t.backend, ref, 200))).toContain("All done.");
		const file = t.fileOf(ref);
		expect(userTexts(file)).toEqual(["Do the slow thing."]);
		expect(toolResults(file)).toEqual(["slept\n"]);
		expect(promptRecords(file)).toBe(1);
		expect(t.router.starts(sessionId)).toBe(1);
		expect(t.world.sessionProcesses()).toBe(1);
		reopened.assertSettled();
	});

	test("leaves its permission ask open; the next bridge asks it again, takes one answer, and the tool runs once", async () => {
		t = await LiveRig.create();
		bridge = new BridgeProcess(t);
		const sessionId = await bridge.open([{ axis: "permissions", value: "ask" }]);
		t.router.replace(sessionId, [call("bash", { command: "echo asked-once" }), say("done")]);
		await bridge.prompt("Ask first.");
		const asked = await bridge.event("interaction_requested");
		await bridge.sigkill();

		await t.rig.restart();
		const reopened = await t.rig.open({ backend: "pi", sessionId });
		const pending = reopened.initial.interactions.find((interaction) => interaction.request.kind === "tool_permission");
		if (pending === undefined) throw new Error("the ask did not survive the bridge");
		expect(pending.title).toBe(asked.interaction.title);
		expect(pending.runId).toBe(reopened.initial.run?.runId);
		const answered = await reopened.control.answer({ interactionId: pending.id, reply: validReply(pending) });
		expect(answered.status).toBe("accepted");
		await reopened.waitFor("run_finished");
		const again = await reopened.control.answer({ interactionId: pending.id, reply: validReply(pending) });
		expect(again.status === "rejected" && again.rejection.code).toBe("stale");
		expect(toolResults(t.fileOf({ backend: "pi", sessionId }))).toEqual(["asked-once\n"]);
	});

	test("whose run ends before the next bridge starts is taken over idle, and its pi then ends", async () => {
		t = await LiveRig.create();
		bridge = new BridgeProcess(t);
		const sessionId = await bridge.open();
		const ref: SessionRef = { backend: "pi", sessionId };
		t.router.replace(sessionId, [call("bash", { command: "sleep 1; echo alone" }), say("Finished alone.")]);
		await bridge.prompt("Work on your own.");
		await bridge.event("tool_started");
		await bridge.sigkill();
		await eventually(() => {
			const file = t?.fileOf(ref);
			return file !== undefined && messagesIn(file).some(([, text]) => text === "Finished alone.");
		}, "the run to finish with no bridge");

		await t.rig.restart();
		const found = await t.backend.getSession(ref);
		expect(found.status === "accepted" && found.summary.status).not.toBe("running");
		await eventually(() => t?.world.sessionProcesses() === 0, "the idle pi to end");
		const reopened = await t.rig.open(ref);
		expect(reopened.initial.run).toBeUndefined();
		expect(answerTexts(await allItems(t.backend, ref, 200))).toContain("Finished alone.");
	});
});

describe("two bridges", () => {
	test("the second takes the session over, and the first sees it go without calling it a crash", async () => {
		t = await LiveRig.create();
		const live = await holdingRun(t, {}, "share me");
		const { world } = t;
		const env = world.env.env();
		const second = piBackendOf(
			createPiParts(
				{ catalog: { emit: () => undefined } },
				{
					install: { cli: { found: true, path: world.cliPath }, env, agentDir: world.env.agentDir },
					hostDir: world.hostDir,
					holders: { root: world.holdersRoot, command: HOLDER_COMMAND },
				},
			),
		);
		try {
			const recorder = new SessionRecorder(15_000);
			const opened = await second.open({ kind: "existing", session: live.ref }, recorder);
			if (opened.status === "rejected") throw new Error(opened.rejection.message);
			expect(opened.snapshot.run).toBeDefined();
			const ended = await live.waitFor("run_finished");
			expect(ended.outcome.kind).toBe("aborted");
			const failures = live.events().filter((event) => event.type === "error" || event.type === "notice");
			expect(failures).toEqual([]);

			t.router.release(live.ref.sessionId);
			await recorder.waitFor((records) => records.find((record) => record.event.type === "run_finished"), "the run");
			expect(t.world.sessionProcesses()).toBe(1);
		} finally {
			await second.dispose();
		}
	});
});

describe("a holder directory", () => {
	test("that nothing answers in is removed at start, and the pid in its holder.json is never signalled", async () => {
		t = await LiveRig.create();
		const sleeper = spawn("sleep", ["30"], { stdio: "ignore" });
		try {
			const dir = holderDirOf(t.world.holdersRoot, "a-gone-session");
			mkdirSync(dir, { recursive: true });
			writeFileSync(socketOf(dir), "");
			const meta = { holderVersion: 1, pid: sleeper.pid, piPid: sleeper.pid, sessionId: "a-gone-session" };
			writeFileSync(metaOf(dir), JSON.stringify({ ...meta, file: "/x", cwd: "/", startedAt: 0, extension: "" }));
			await t.rig.restart();
			await t.backend.listSessions({}, { limit: 1 });
			expect(spawnSync("test", ["-e", dir]).status).not.toBe(0);
			expect(isAlive(sleeper.pid ?? 0)).toBe(true);
		} finally {
			sleeper.kill();
		}
	});

	test("holds no secret of pi's environment in the holder's argv", async () => {
		t = await LiveRig.create();
		process.env.BROSKI_TEST_SECRET = "sk-test-not-in-argv-4242";
		await t.rig.restart();
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "reply" });
		await live.run("hello");
		const meta = JSON.parse(readFileSync(metaOf(holderDirOf(t.world.holdersRoot, live.ref.sessionId)), "utf8"));
		const argv = spawnSync("ps", ["-ww", "-o", "args=", "-p", String(meta.pid)], { encoding: "utf8" }).stdout;
		expect(argv).toContain("__pi-holder");
		expect(argv).not.toContain("sk-test-not-in-argv-4242");
		expect(readFileSync(metaOf(holderDirOf(t.world.holdersRoot, live.ref.sessionId)), "utf8")).not.toContain(
			"sk-test-not-in-argv-4242",
		);
		delete process.env.BROSKI_TEST_SECRET;
	});
});
