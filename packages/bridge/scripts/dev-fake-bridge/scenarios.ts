import { sampleRequest } from "../../src/contract/testing/fake-scenarios";
import type { FakeStep } from "../../src/contract/testing/fake-script";

export const FAKE_SCENARIOS = ["ask", "hold", "replace", "permission", "work", "hold_and_ask", "stream"] as const;
export type FakeScenarioName = (typeof FAKE_SCENARIOS)[number];

const EDIT = {
	path: "notes.md",
	change: "modified",
	diff: "@@ -1 +1 @@\n-one\n+two\n",
	additions: 1,
	deletions: 1,
} as const;

const STREAM_PACE_MS = 120;

/**
 * What the fake's next run of a session does, by name: `ask` stops on a choice until a phone answers
 * it; `hold` streams, waits for `release`, and streams again; `replace` streams, waits for `release`,
 * then goes on as a new session (a `/clear`), and streams once more; `permission` asks before running
 * a command; `work` streams most of what a run can hold, many blocks of it; `hold_and_ask` holds, then
 * does the work and stops on a choice, so a run stays mid-way with everything it streamed; `stream`
 * writes its text slowly, a part every 120 ms, so a block is open and growing for a while, and makes a
 * file edit that stays in the transcript.
 */
export function fakeScenario(name: FakeScenarioName): FakeStep[] {
	switch (name) {
		case "ask":
			return [
				{ kind: "ask", title: "Pick one", request: sampleRequest("choice") },
				{ kind: "text", text: "Thanks." },
			];
		case "hold":
			return [{ kind: "text", text: "Working." }, { kind: "hold" }, { kind: "text", text: "Done holding." }];
		case "replace":
			return [
				{ kind: "text", text: "Working." },
				{ kind: "hold" },
				{ kind: "replace_session" },
				{ kind: "text", text: "Moved on." },
			];
		case "permission":
			return [
				{ kind: "tool", name: "bash", input: { command: "rm -rf build" }, output: "removed", permission: true },
				{ kind: "text", text: "Cleaned." },
			];
		case "work":
			return workSteps();
		case "stream":
			return [
				{
					kind: "text",
					text: "Streaming this answer a few words at a time, so its block changes while it is read.",
					paceMs: STREAM_PACE_MS,
				},
				{ kind: "tool", name: "edit", input: { path: "notes.md" }, output: "line one", fileChanges: [EDIT] },
				{ kind: "text", text: "Edited notes.md, and the edit stays in the transcript.", paceMs: STREAM_PACE_MS },
			];
		case "hold_and_ask":
			return [
				{ kind: "text", text: "Working." },
				{ kind: "hold" },
				...workSteps(),
				{ kind: "ask", title: "Pick one", request: sampleRequest("choice") },
				{ kind: "text", text: "Thanks." },
			];
	}
}

function workSteps(): FakeStep[] {
	const paragraphs = Array.from({ length: 24 }, (_, index): FakeStep => {
		return { kind: "text", text: `Paragraph ${index + 1}: what the agent found, streamed in parts.` };
	});
	return [
		{ kind: "thinking", text: "Reading the notes before anything else." },
		{
			kind: "tool",
			name: "edit",
			input: { path: "notes.md" },
			output: "line one\nline two\nline three",
			streamInput: true,
			fileChanges: [EDIT],
			nested: [{ kind: "tool", name: "grep", input: { pattern: "one" }, output: "line one" }],
		},
		{ kind: "usage", usage: { inputTokens: 120, outputTokens: 40, costUsd: 0.01 } },
		{ kind: "notice", level: "info", text: "Halfway there." },
		{ kind: "retry", attempts: 2 },
		{ kind: "compaction" },
		{ kind: "text", text: "A draft the agent withdraws." },
		{ kind: "retract" },
		...paragraphs,
	];
}
