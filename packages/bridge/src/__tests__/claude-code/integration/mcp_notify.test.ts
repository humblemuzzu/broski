/**
 * The real CLI with the bridge's MCP server in its options: it connects over HTTP with the session's token, lists
 * only `broski_notify` to the model, and runs it without a permission ask, while `AskUserQuestion` and
 * `ExitPlanMode` stay Claude Code's own.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CatalogRecorder, Rig } from "../../../contract/testing/conformance-harness";
import { McpRig } from "../../helpers/mcp-rig";
import { ClaudeCodeConformanceDriver } from "../conformance/driver";
import { ClaudeWorld } from "../conformance/world";
import { CLI_TEST_MS } from "./rig";

const WAIT_MS = 20_000;

let mcp: McpRig;
let world: ClaudeWorld;
let rig: Rig;

beforeAll(async () => {
	mcp = new McpRig();
	const catalog = new CatalogRecorder(WAIT_MS);
	world = await ClaudeWorld.create({ catalog }, undefined, {
		mcpServer: (sessionId) => {
			const session = { backend: "claude-code", sessionId };
			const credential = mcp.registry.issue({ session, tools: { ask: false, plan: false, notify: true } });
			return {
				server: { name: "broski", url: mcp.url, token: credential.token },
				rebind: (next) => credential.rebind({ ...session, sessionId: next }),
				release: credential.revoke,
			};
		},
	});
	rig = new Rig(world.backend, new ClaudeCodeConformanceDriver(world, WAIT_MS), catalog, WAIT_MS);
});

afterAll(async () => {
	await rig.backend.dispose();
	const leftLive = mcp.registry.size;
	const escapes = world.escapes();
	await world.dispose();
	mcp.stop();
	expect(escapes).toEqual([]);
	expect(leftLive).toBe(0);
});

function toolNames(body: unknown): string[] {
	const tools = typeof body === "object" && body !== null ? Reflect.get(body, "tools") : undefined;
	return Array.isArray(tools) ? tools.map((tool) => String(Reflect.get(tool, "name"))) : [];
}

describe("broski_notify in Claude Code", () => {
	test(
		"reaches the bridge for this session, unasked, and is the only Broski tool the model sees",
		async () => {
			const live = await rig.openNew();
			const notify = { name: "mcp__broski__broski_notify", args: { title: "Build done", urgency: "high" } };
			world.router.script(live.ref.sessionId, [{ toolCalls: [notify] }, { text: ["Sent."] }]);

			expect((await live.run("Tell my phone the build is done.")).outcome.kind).toBe("completed");
			expect(mcp.sink.notices).toEqual([
				{ session: live.ref, notice: { level: "info", text: "Build done", urgent: true } },
			]);
			expect(live.events().filter((event) => event.type === "interaction_requested")).toEqual([]);
			const finished = live.events().find((event) => event.type === "tool_finished");
			expect(finished?.type === "tool_finished" && finished.outcome).toBe("completed");

			const seen = toolNames(world.router.requests(live.ref.sessionId)[0]?.body);
			expect(seen).toContain("mcp__broski__broski_notify");
			expect(seen).toContain("AskUserQuestion");
			expect(seen.filter((name) => name.startsWith("mcp__broski__"))).toEqual(["mcp__broski__broski_notify"]);
		},
		CLI_TEST_MS,
	);
});
