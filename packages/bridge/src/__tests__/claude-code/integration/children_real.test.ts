/**
 * A subagent's work through the whole adapter and the real CLI: the parent's Agent call names the child session, and
 * the child, opened while the agent works, streams that work as a run of its own. A foreground agent's work is also
 * nested in the parent's run while its call is open; a background agent's call is over first, so its work goes to the
 * child alone.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { claudeCodeBackendFactory } from "../../../backends/claude-code/factory";
import type { AgentBackend, AgentEvent, SessionRef, ToolUpdatedEvent } from "../../../contract";
import { CatalogRecorder, LiveSession, SessionRecorder } from "../../../contract/testing/conformance-harness";
import { claudeTestEnv, createClaudeHome } from "../../helpers/claude-home";
import { type ScriptedTurn, serveScriptedAnthropic } from "../../helpers/scripted-anthropic-server";
import { isolatedClaudeSdk } from "../helpers/isolated-sdk";
import { testClaudeBinary } from "../helpers/test-claude-cli";
import { expectNoOrphans } from "../spike/rig/orphans";

expectNoOrphans();

const CLI_TEST_MS = 60_000;
const WAIT_MS = 30_000;
const SUBAGENT_TURNS: ScriptedTurn[] = [
	{ toolCalls: [{ name: "Read", args: { file_path: "README.md" } }] },
	{ text: Array.from({ length: 12 }, (_, i) => `part${i} `), delayMs: 120 },
];

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function world(background: boolean) {
	const home = createClaudeHome();
	const agentCall = {
		description: "Find the word",
		prompt: "Read README.md",
		subagent_type: "general-purpose",
		run_in_background: background,
	};
	const turns: ScriptedTurn[] = [
		{ toolCalls: [{ name: "Agent", args: agentCall }] },
		{ text: [background ? "Launched." : "The subagent finished."] },
		{ text: ["Woken by the agent."] },
	];
	const server = serveScriptedAnthropic(turns, { sideRequests: { subagent: SUBAGENT_TURNS } });
	const env = claudeTestEnv({ url: server.url, home, proxy: server.proxyUrl });
	const backend = await claudeCodeBackendFactory({
		cli: { found: true, path: testClaudeBinary() },
		env,
		stateDir: join(home.root, "broski-state"),
		clientApp: "broski/test",
		sdk: isolatedClaudeSdk(env),
	})({ catalog: new CatalogRecorder(WAIT_MS) });
	cleanups.push(async () => {
		await backend.dispose();
		const escapes = server.escapes();
		server.stop();
		home.cleanup();
		expect(escapes).toEqual([]);
	});
	return { backend, cwd: home.projectDir };
}

async function open(backend: AgentBackend, target: Parameters<AgentBackend["open"]>[0]): Promise<LiveSession> {
	const recorder = new SessionRecorder(WAIT_MS);
	const opened = await backend.open(target, recorder);
	if (opened.status === "rejected") throw new Error(`open was rejected: ${opened.rejection.message}`);
	return new LiveSession(opened.session, opened.snapshot, recorder, backend.traits);
}

const isChildSession = (event: ToolUpdatedEvent) => event.update.kind === "child_session";

function childOf(event: ToolUpdatedEvent): SessionRef {
	if (event.update.kind !== "child_session") throw new Error("not a child session update");
	return event.update.session;
}

const types = (events: readonly AgentEvent[]) => events.map((event) => event.type);

describe("a subagent over the real CLI", () => {
	test(
		"in the foreground: the child streams its run while the parent shows the same work nested under the call",
		async () => {
			const { backend, cwd } = await world(false);
			const parent = await open(backend, { kind: "new", options: { cwd } });
			expect((await parent.prompt("Use a subagent.")).status).toBe("accepted");
			const named = await parent.waitFor("tool_updated", isChildSession);
			const child = await open(backend, { kind: "existing", session: childOf(named) });
			expect(child.session.control).toBeUndefined();
			const childRun = await child.waitFor("run_finished");
			expect(childRun.outcome).toEqual({ kind: "completed" });
			const shown = types(child.events());
			expect(shown).toContain("block_finished");
			expect(child.events().some((event) => event.type === "tool_started" && event.name === "Read")).toBe(true);
			await parent.waitFor("run_finished");
			const nested = parent
				.events()
				.filter((event) => event.type === "tool_started" && event.parentToolCallId === named.toolCallId);
			expect(nested.length).toBeGreaterThan(0);
			child.assertSettled();
			parent.assertSettled();
			await child.close();
			await parent.close();
		},
		CLI_TEST_MS,
	);

	test(
		"in the background: the call is over before the agent works, so its work reaches the child alone",
		async () => {
			const { backend, cwd } = await world(true);
			const parent = await open(backend, { kind: "new", options: { cwd } });
			expect((await parent.prompt("Start a background subagent.")).status).toBe("accepted");
			const named = await parent.waitFor("tool_updated", isChildSession);
			const child = await open(backend, { kind: "existing", session: childOf(named) });
			const childRun = await child.waitFor("run_finished");
			expect(childRun.outcome).toEqual({ kind: "completed" });
			expect(types(child.events())).toContain("block_finished");
			await parent.waitFor("run_finished");
			const nested = parent
				.events()
				.filter((event) => event.type === "tool_started" && event.parentToolCallId === named.toolCallId);
			expect(nested).toEqual([]);
			child.assertSettled();
			parent.assertSettled();
			await child.close();
			await parent.close();
		},
		CLI_TEST_MS,
	);
});
