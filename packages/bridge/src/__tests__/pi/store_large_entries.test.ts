/** Entries tens of megabytes long, as real tool results are: read whole up to the line bound, a notice past it. */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { CatalogFeed } from "../../backends/pi/catalog-feed";
import type { LiveOverlay, SessionStore } from "../../backends/pi/ports";
import { MAX_LINE_BYTES } from "../../backends/pi/store/line-scanner";
import { createSessionStore } from "../../backends/pi/store/session-store";
import type { TranscriptItem } from "../../contract";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";
import { SessionBuilder, textBlock, toolCall, writeSession } from "./store_fixtures";

let env: PiTestEnv;
let store: SessionStore;
const NOBODY: LiveOverlay = { row: () => undefined };

beforeEach(() => {
	env = createPiTestEnv();
	store = createSessionStore({
		agentDir: env.agentDir,
		catalog: new CatalogFeed({ emit: () => undefined }),
		now: Date.now,
	});
});

afterEach(() => {
	store.dispose();
	env.dispose();
});

test("a 40 MB tool result reads whole, and one past the line bound is a notice between the items around it", async () => {
	const builder = new SessionBuilder({ id: "big", cwd: env.cwd, version: 3 });
	builder.user("read both", 1_000);
	builder.assistant([toolCall("call-a"), toolCall("call-b")], 2_000);
	builder.toolResult("call-a", "a".repeat(40 * 1_048_576), 3_000);
	builder.toolResult("call-b", "b".repeat(MAX_LINE_BYTES + 1_024), 4_000);
	builder.assistant([textBlock("done")], 5_000);
	writeSession(env.sessionDir, builder);

	const read = await store.transcript("big", { limit: 50 }, NOBODY);
	if (read.status === "rejected") throw new Error(read.rejection.message);
	const items = [...read.page.items].reverse();
	const kinds = items.map((item) => item.kind);
	expect(kinds.at(-1)).toBe("block");
	const notices = items.filter((item): item is Extract<TranscriptItem, { kind: "notice" }> => item.kind === "notice");
	expect(notices).toHaveLength(1);
	expect(notices[0]).toMatchObject({ level: "warning", text: expect.stringContaining("65 MB is too large") });
	const results = items.filter((item) => item.kind === "tool_result");
	expect(results).toHaveLength(1);
	expect(kinds.indexOf("notice")).toBeGreaterThan(kinds.indexOf("tool_result"));
	expect(kinds.indexOf("notice")).toBeLessThan(kinds.lastIndexOf("block"));
}, 60_000);
