/**
 * What the conformance driver and adapter README D10 rest on, against the real CLI: each request names its session, a
 * gated answer holds the run until released, and a send's `uuid` is the uuid of its transcript entry.
 */

import { describe, expect, test } from "bun:test";
import { claudeTestEnv } from "../../helpers/claude-home";
import { isolatedClaudeSdk } from "../helpers/isolated-sdk";
import { expectNoOrphans } from "../spike/rig/orphans";
import { isIdle, startSpike } from "../spike/rig/session";
import { SessionRouter } from "./session-router";

expectNoOrphans();

const CLI_TEST_MS = 30_000;

describe("the conformance session router", () => {
	test(
		"routes by session, holds at a gate, and the transcript keeps the send's uuid",
		async () => {
			const sessionId = crypto.randomUUID();
			const router = new SessionRouter();
			router.script(sessionId, [{ text: ["Routed."] }, { text: ["Held."], gate: router.gate(sessionId) }]);
			const spike = startSpike({
				permissionMode: "default",
				turns: [],
				options: { sessionId },
				server: { routes: router.routes() },
			});
			try {
				const first = spike.send("first");
				await spike.waitFor((m) => m.type === "result" && m.user_message_uuids?.includes(first) === true);
				spike.send("second");
				await Bun.sleep(500);
				expect(spike.results()).toHaveLength(1);
				router.release(sessionId);
				await spike.waitFor((m) => m.type === "result" && m.subtype === "success" && m.result === "Held.");
				await spike.waitFor(isIdle, { after: spike.messages.length - 1 });
				expect(router.requests(sessionId)).toHaveLength(2);
				expect(spike.server.escapes()).toEqual([]);
				const env = claudeTestEnv({ url: spike.server.url, home: spike.home });
				const sdk = isolatedClaudeSdk(env);
				try {
					const chain = await sdk.getSessionMessages(sessionId, { dir: spike.home.projectDir });
					expect(chain[0]?.uuid).toBe(first);
				} finally {
					await sdk.dispose();
				}
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);
});
