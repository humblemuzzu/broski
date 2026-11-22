/** The context figure is asked of the live host once a run has finished, and sent over the usage it had. */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent, Usage } from "../../../contract";
import { FakeQuery } from "../helpers/fake-query";
import { expectNoOrphans } from "../spike/rig/orphans";
import { flush, promptOf, tempProject } from "./helpers/fake-host";
import { idle, init, result, running } from "./helpers/frames";
import { fakeRig, realRig } from "./helpers/rig";

expectNoOrphans();

const projects: { remove: () => void }[] = [];

afterEach(() => {
	for (const project of projects.splice(0)) project.remove();
});

function contextAnswer(totalTokens: number, maxTokens: number): SDKControlGetContextUsageResponse {
	return {
		categories: [],
		totalTokens,
		maxTokens,
		rawMaxTokens: maxTokens,
		percentage: (100 * totalTokens) / maxTokens,
		gridRows: [],
		model: "claude-opus-5-5",
		memoryFiles: [],
		mcpTools: [],
		agents: [],
		isAutoCompactEnabled: true,
		apiUsage: null,
	};
}

async function oneRun(query: FakeQuery) {
	const rig = fakeRig([query]);
	const project = tempProject();
	projects.push(project);
	const live = await rig.openNew(project.dir);
	await live.control.prompt(promptOf("hello"));
	query.push(running(), init());
	await flush();
	const askedDuringRun = query.calls.some((call) => call.method === "getContextUsage");
	query.push(idle());
	await flush();
	return { rig, live, askedDuringRun };
}

const types = (events: readonly AgentEvent[]) => events.map((event) => event.type);

describe("the context usage after a run", () => {
	test("is asked once after run_finished, never during the run, and sent as usage_updated with the window", async () => {
		const query = new FakeQuery({ getContextUsage: async () => contextAnswer(12_345, 200_000) });
		const { rig, live, askedDuringRun } = await oneRun(query);
		expect(askedDuringRun).toBe(false);
		expect(query.calls.filter((call) => call.method === "getContextUsage").map((call) => call.args)).toEqual([
			[{ detail: "summary" }],
		]);
		const events = live.events();
		expect(types(events).slice(-2)).toEqual(["run_finished", "usage_updated"]);
		expect(events.at(-1)).toEqual({ type: "usage_updated", usage: { contextTokens: 12_345, contextWindow: 200_000 } });
		expect(live.reduced().usage).toEqual({ contextTokens: 12_345, contextWindow: 200_000 });
		await rig.dispose();
	});

	test("goes over the run's totals and cache window as they were, and a figure the snapshot has is not sent again", async () => {
		const query = new FakeQuery({ getContextUsage: async () => contextAnswer(8_110, 200_000) });
		const rig = fakeRig([query]);
		const usage: Usage = {
			inputTokens: 110,
			cacheReadTokens: 8_000,
			cache: { lastTouchAt: 1_000, ttlMs: 300_000, confidence: "exact" },
		};
		rig.mapping.script((frame) => (frame.type === "result" ? [{ event: { type: "usage_updated", usage } }] : []));
		const project = tempProject();
		projects.push(project);
		const live = await rig.openNew(project.dir);
		await live.control.prompt(promptOf("hello"));
		query.push(running(), init(), result(), idle());
		await flush();
		expect(live.events().at(-1)).toEqual({
			type: "usage_updated",
			usage: { ...usage, contextTokens: 8_110, contextWindow: 200_000 },
		});
		await live.control.prompt(promptOf("again"));
		query.push(running(), idle());
		await flush();
		expect(query.calls.filter((call) => call.method === "getContextUsage")).toHaveLength(2);
		expect(types(live.events()).at(-1)).toBe("run_finished");
		await rig.dispose();
	});

	test("a live CLI that fails to answer is logged, sends nothing more, and the run has finished all the same", async () => {
		const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
		try {
			const query = new FakeQuery({ getContextUsage: async () => Promise.reject(new Error("no context today")) });
			const { rig, live } = await oneRun(query);
			expect(types(live.events()).at(-1)).toBe("run_finished");
			expect(stderr).toHaveBeenCalledWith("[claude-code] context usage after a run: no context today\n");
			await rig.dispose();
		} finally {
			stderr.mockRestore();
		}
	});

	test("a host closed while the answer is pending is not a failure: the SDK rejects the request as its query closes", async () => {
		const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
		try {
			let closeQuery: (error: Error) => void = () => undefined;
			const query = new FakeQuery({
				getContextUsage: () =>
					new Promise((_, reject) => {
						closeQuery = reject;
					}),
			});
			const { rig, live } = await oneRun(query);
			await rig.dispose();
			closeQuery(new Error("Query closed before response received"));
			await flush();
			expect(types(live.events()).at(-1)).toBe("run_finished");
			expect(stderr).not.toHaveBeenCalled();
		} finally {
			stderr.mockRestore();
		}
	});

	test("the real CLI answers it after a turn, and the figure is a whole number of tokens within the window", async () => {
		const rig = realRig([{ text: ["done"] }]);
		try {
			const live = await rig.openNew(rig.home.projectDir);
			await live.run("hello");
			const usage = await live.waitFor("usage_updated", (event) => event.usage.contextTokens !== undefined);
			expect(usage.usage.contextTokens).toBeGreaterThan(0);
			expect(usage.usage.contextWindow ?? 0).toBeGreaterThan(usage.usage.contextTokens ?? 0);
		} finally {
			await rig.dispose();
		}
	}, 30_000);
});
