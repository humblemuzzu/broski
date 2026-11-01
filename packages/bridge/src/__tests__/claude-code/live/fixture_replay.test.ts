/** Every frame the spike recorded from the real CLI, replayed through a host: it keeps its runs in step and never faults. */

import { afterEach, describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { FakeQuery } from "../helpers/fake-query";
import { frameScenarios, readFrameFixture } from "../helpers/frame-fixtures";
import { flush, tempProject } from "./helpers/fake-host";
import { fakeRig } from "./helpers/rig";

const projects: { remove: () => void }[] = [];

afterEach(() => {
	for (const project of projects.splice(0)) project.remove();
});

const isState = (frame: SDKMessage, state: string) =>
	frame.type === "system" && frame.subtype === "session_state_changed" && frame.state === state;

describe("the recorded frames", () => {
	for (const scenario of frameScenarios()) {
		test(`${scenario}: one run per idle, closed in order, no fault`, async () => {
			const frames = readFrameFixture(scenario);
			const query = new FakeQuery();
			const rig = fakeRig([query]);
			const project = tempProject();
			projects.push(project);
			const live = await rig.openNew(project.dir);
			query.push(...frames);
			await flush();
			const idles = frames.filter((frame) => isState(frame, "idle")).length;
			const events = live.events();
			expect(events.filter((event) => event.type === "notice")).toEqual([]);
			expect(events.filter((event) => event.type === "run_finished")).toHaveLength(idles);
			expect(events.filter((event) => event.type === "run_started")).toHaveLength(idles + (live.reduced().run ? 1 : 0));
			live.assertValid();
			expect(rig.mapping.mapped.length).toBeGreaterThan(0);
			await rig.dispose();
		});
	}
});
