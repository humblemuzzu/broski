/**
 * One Pi chat through the whole bridge: a scripted model that thinks, runs bash twice and answers. What the
 * phone receives while the turn runs is the contract, so every assertion reads events a client got, not
 * connector internals.
 */

import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { appendFile } from "node:fs/promises";
import { resolveSessionFilePath } from "../connectors/pi/pi-session-queries";
import type { BroskiRuntimeEvent } from "../types/runtime";
import { E2E_TEST_TIMEOUT_MS } from "./e2e/harness";
import { framesOf, type PiLiveRig, runtimeEventsOf, startPiLiveRig, waitForEvent } from "./helpers/pi-live-rig";
import type { ScriptedTurn } from "./helpers/scripted-openai-server";
import type { LinkFrame } from "./link/unix-ws";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const ABORT_BUDGET_MS = 2000;
const PROCESS_POLL_MS = 25;
/** The session-file tail polls every 150 ms; a duplicate it would send shows up well inside this. */
const TAIL_SETTLE_MS = 500;

const COMMITS_TURNS: ScriptedTurn[] = [
	{
		thinking: ["Count the ", "commits."],
		toolCalls: [{ name: "bash", args: { command: "echo first-output", timeout: 15 } }],
	},
	{
		thinking: ["Show them."],
		toolCalls: [{ name: "bash", args: { command: "echo second-output", timeout: 15 } }],
	},
	{ text: ["Nothing ", "to push."] },
];

const typesOf = (events: BroskiRuntimeEvent[]): string[] => events.map((event) => event.type);

function ofType<T extends BroskiRuntimeEvent["type"]>(
	events: BroskiRuntimeEvent[],
	type: T,
): Extract<BroskiRuntimeEvent, { type: T }>[] {
	return events.filter((event): event is Extract<BroskiRuntimeEvent, { type: T }> => event.type === type);
}

function text(events: BroskiRuntimeEvent[], type: "assistant_text_delta" | "assistant_thinking_delta"): string {
	return ofType(events, type)
		.map((event) => event.delta)
		.join("");
}

let rig: PiLiveRig | null = null;

afterEach(async () => {
	await rig?.stop();
	rig = null;
});

afterAll(async () => {
	await rig?.stop();
});

describe("a Pi turn reaches a phone that only sent the prompt", () => {
	for (const bashParam of ["command", "cmd"] as const) {
		test(`tool arguments, output, thinking and the answer arrive live (bash takes \`${bashParam}\`)`, async () => {
			const turns = bashParam === "cmd" ? COMMITS_TURNS.map(renameCommandToCmd) : COMMITS_TURNS;
			rig = await startPiLiveRig({ turns, cmdBash: bashParam === "cmd" });
			await rig.newSession();
			rig.client.clear();

			await rig.chat("how many commits?");
			await waitForEvent(rig.client, "agent_finished");
			const events = runtimeEventsOf(rig.client);

			const started = ofType(events, "tool_started");
			expect(started.map((event) => event.toolName)).toEqual(["bash", "bash"]);
			expect(started.map((event) => (event.input as Record<string, unknown>)[bashParam])).toEqual([
				"echo first-output",
				"echo second-output",
			]);
			const finished = ofType(events, "tool_finished");
			expect(finished).toHaveLength(2);
			expect(String(finished[0]?.output)).toContain("first-output");
			expect(String(finished[1]?.output)).toContain("second-output");
			expect(ofType(events, "tool_updated").length).toBeGreaterThan(0);
			expect(text(events, "assistant_thinking_delta")).toBe("Count the commits.Show them.");
			expect(text(events, "assistant_text_delta")).toBe("Nothing to push.");
		});
	}

	test("the agent starts once and finishes once, however many model turns the tools cause", async () => {
		rig = await startPiLiveRig({ turns: COMMITS_TURNS });
		await rig.newSession();
		rig.client.clear();

		await rig.chat("how many commits?");
		await waitForEvent(rig.client, "agent_finished");
		const types = typesOf(runtimeEventsOf(rig.client));

		expect(types.filter((type) => type === "agent_started")).toHaveLength(1);
		expect(types.filter((type) => type === "agent_finished")).toHaveLength(1);
		expect(types.at(-1)).toBe("agent_finished");
		expect(types.indexOf("tool_finished")).toBeLessThan(types.lastIndexOf("agent_finished"));
	});

	test("no runtime state claims the session is still streaming after the agent finished", async () => {
		rig = await startPiLiveRig({ turns: COMMITS_TURNS });
		await rig.newSession();
		rig.client.clear();

		await rig.chat("how many commits?");
		await waitForEvent(rig.client, "agent_finished");
		await rig.client.waitForWhere(
			(frame) => runtimeStates(frame).some((state) => state.isStreaming === false),
			"the settled runtime_state",
		);
		const frames = framesOf(rig.client);
		const finishedAt = frames.findIndex(
			(frame) => frame.type === "runtime_event" && eventType(frame) === "agent_finished",
		);
		const statesAfter = frames.slice(finishedAt).filter((frame) => frame.type === "runtime_state");

		expect(statesAfter.length).toBeGreaterThan(0);
		for (const state of statesAfter) expect((state.data as { isStreaming: boolean }).isStreaming).toBe(false);
	});

	test("a tool result is finished before the next model turn's events", async () => {
		rig = await startPiLiveRig({ turns: COMMITS_TURNS });
		await rig.newSession();
		rig.client.clear();

		await rig.chat("how many commits?");
		await waitForEvent(rig.client, "agent_finished");
		const events = runtimeEventsOf(rig.client);
		const firstFinished = events.findIndex((event) => event.type === "tool_finished");
		const secondStarted = events.findIndex(
			(event, index) => event.type === "tool_started" && index > firstFinished && firstFinished >= 0,
		);

		expect(firstFinished).toBeGreaterThan(-1);
		expect(secondStarted).toBeGreaterThan(firstFinished);
	});
});

describe("a Pi turn the phone is viewing", () => {
	test("every event arrives once, not again from the session file", async () => {
		rig = await startPiLiveRig({ turns: COMMITS_TURNS });
		const sessionId = await rig.newSession();
		rig.view(sessionId);
		rig.client.clear();

		await rig.chat("how many commits?");
		await waitForEvent(rig.client, "agent_finished");
		await Bun.sleep(TAIL_SETTLE_MS);
		const events = runtimeEventsOf(rig.client);

		expect(ofType(events, "tool_started")).toHaveLength(2);
		expect(ofType(events, "agent_started")).toHaveLength(1);
		expect(ofType(events, "agent_finished")).toHaveLength(1);
		expect(text(events, "assistant_text_delta")).toBe("Nothing to push.");
		expect(text(events, "assistant_thinking_delta")).toBe("Count the commits.Show them.");
	});

	test("events carry a seq the app can use to notice a gap", async () => {
		rig = await startPiLiveRig({ turns: COMMITS_TURNS });
		const sessionId = await rig.newSession();
		rig.view(sessionId);
		rig.client.clear();

		await rig.chat("how many commits?");
		await waitForEvent(rig.client, "agent_finished");
		const seqs = runtimeEventsOf(rig.client).flatMap((event) => (event.seq === undefined ? [] : [event.seq]));

		expect(seqs.length).toBeGreaterThan(5);
		expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
	});
});

describe("a Pi session the phone keeps viewing", () => {
	test("follows the terminal again once the bridge's own turn has settled", async () => {
		rig = await startPiLiveRig({ turns: COMMITS_TURNS });
		const sessionId = await rig.newSession();
		rig.view(sessionId);
		await rig.chat("how many commits?");
		await waitForEvent(rig.client, "agent_finished");
		const sessionFile = await resolveSessionFilePath(sessionId);
		rig.client.clear();

		await appendFile(sessionFile ?? "", `${JSON.stringify(terminalUserEntry("typed in the terminal"))}\n`);

		await rig.client.waitForWhere(
			(frame) => JSON.stringify(frame).includes("typed in the terminal"),
			"the prompt typed in the terminal",
		);
	});
});

describe("stopping a Pi turn", () => {
	test("pi_abort ends the turn within two seconds and kills the running command", async () => {
		rig = await startPiLiveRig({
			turns: [{ toolCalls: [{ name: "bash", args: { command: "echo pid=$$; sleep 60", timeout: 120 } }] }],
		});
		await rig.newSession();
		rig.client.clear();
		await rig.chat("run the long thing");
		const pid = await runningCommandPid(rig);
		expect(isAlive(pid)).toBe(true);

		const abortedAt = Date.now();
		await rig.abort();
		await waitForEvent(rig.client, "agent_finished", ABORT_BUDGET_MS);

		expect(Date.now() - abortedAt).toBeLessThan(ABORT_BUDGET_MS);
		await waitUntilGone(pid);
		expect(isAlive(pid)).toBe(false);
	});
});

async function runningCommandPid(live: PiLiveRig): Promise<number> {
	const output = await live.client.waitForWhere((frame) => framesWithPid(frame).length > 0, "the command's pid");
	return Number(/pid=(\d+)/.exec(JSON.stringify(framesWithPid(output)))?.[1]);
}

function framesWithPid(frame: Record<string, unknown>): unknown[] {
	const inner = frame.type === "batch" ? (frame.messages as Record<string, unknown>[]) : [frame];
	return inner.filter((message) => /pid=\d+/.test(JSON.stringify(message)) && message.type === "runtime_event");
}

function eventType(frame: LinkFrame): string {
	return (frame.data as BroskiRuntimeEvent).type;
}

function runtimeStates(frame: LinkFrame): Array<{ isStreaming: boolean }> {
	const inner = frame.type === "batch" ? (frame.messages as LinkFrame[]) : [frame];
	return inner
		.filter((message) => message.type === "runtime_state")
		.map((message) => message.data as { isStreaming: boolean });
}

function terminalUserEntry(content: string): object {
	return {
		type: "message",
		id: "terminal-user",
		parentId: null,
		timestamp: new Date().toISOString(),
		message: { role: "user", content, timestamp: Date.now() },
	};
}

function renameCommandToCmd(turn: ScriptedTurn): ScriptedTurn {
	return {
		...turn,
		toolCalls: turn.toolCalls?.map((call) => ({
			...call,
			args: { cmd: call.args.command, timeout: call.args.timeout },
		})),
	};
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** A process that was killed is gone a moment later; the OS offers no event to wait on. */
async function waitUntilGone(pid: number): Promise<void> {
	const deadline = Date.now() + ABORT_BUDGET_MS;
	while (isAlive(pid)) {
		if (Date.now() > deadline) return;
		await Bun.sleep(PROCESS_POLL_MS);
	}
}
