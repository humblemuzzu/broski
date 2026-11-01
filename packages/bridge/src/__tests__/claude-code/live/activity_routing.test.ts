/** Step 7: a hook's activity reaches the session only inside a run (contract stream rules); outside one it is left out. */

import { afterEach, describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MappedEvent } from "../../../backends/claude-code/ports/mapping";
import { FakeQuery } from "../helpers/fake-query";
import { flush, tempProject } from "./helpers/fake-host";
import { frame, idle, running } from "./helpers/frames";
import { fakeRig } from "./helpers/rig";
import { standInMapping } from "./helpers/stand-ins";

const projects: { remove: () => void }[] = [];

afterEach(() => {
	for (const project of projects.splice(0)) project.remove();
});

const hook = (id: string) => frame({ type: "system", subtype: "hook_started", hook_id: id, hook_name: "SessionEnd" });

function asActivity(message: SDKMessage): readonly MappedEvent[] {
	if (message.type !== "system" || message.subtype !== "hook_started") return [];
	return [{ event: { type: "activity", activity: { id: message.hook_id, label: "SessionEnd", status: "succeeded" } } }];
}

describe("an activity and the run", () => {
	test("is shown inside a run and left out when no run is on", async () => {
		const mapping = standInMapping();
		mapping.script(asActivity);
		const query = new FakeQuery();
		const rig = fakeRig([query], { mapping });
		const project = tempProject();
		projects.push(project);
		const live = await rig.openNew(project.dir);
		query.push(hook("before"), running(), hook("inside"), idle(), hook("after"));
		await flush();
		const shown = live.events().flatMap((event) => (event.type === "activity" ? [event.activity.id] : []));
		expect(shown).toEqual(["inside"]);
		expect(
			mapping.mapped.filter((message) => message.type === "system" && message.subtype === "hook_started"),
		).toHaveLength(3);
		await rig.dispose();
	});
});
