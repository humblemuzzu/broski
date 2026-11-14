/** The assembled backend over a fake SDK: constructible, typed, and silent once disposed. */

import { describe, expect, test } from "bun:test";
import { claudeCodeBackendFactory } from "../../../backends/claude-code/factory";
import {
	type AgentBackend,
	BackendStatus,
	backendCapabilities,
	Capabilities,
	type CatalogEvent,
} from "../../../contract";
import { fakeClaudeSdk } from "../helpers/fake-claude-sdk";

const SESSION = crypto.randomUUID();

async function skeleton(): Promise<{ backend: AgentBackend; events: CatalogEvent[] }> {
	const events: CatalogEvent[] = [];
	const factory = claudeCodeBackendFactory({
		cli: { found: false, reason: "not needed" },
		env: {},
		stateDir: "/nonexistent/claude-code-state",
		clientApp: "broski/test",
		sdk: fakeClaudeSdk(),
	});
	return { backend: await factory({ catalog: { emit: (event) => events.push(event) } }), events };
}

describe("the Claude Code backend, assembled", () => {
	test("declares valid capabilities: fork, rename and delete, no archive", async () => {
		const { backend } = await skeleton();
		expect(Capabilities.safeParse(backendCapabilities(backend)).success).toBe(true);
		expect(backendCapabilities(backend)).toMatchObject({ fork: true, rename: true, delete: true, archive: false });
	});

	test("refuses another backend's sessions not_found and reports an honest status", async () => {
		const { backend } = await skeleton();
		const ref = { backend: "pi" as const, sessionId: SESSION };
		const reads = [
			await backend.getSession(ref),
			await backend.readTranscript(ref, { limit: 10 }),
			await backend.readAttachment(ref, "a"),
			await backend.open({ kind: "existing", session: ref }, { emit: () => undefined }),
		];
		for (const read of reads) expect(read.status === "rejected" && read.rejection.code).toBe("not_found");
		const status = await backend.status();
		expect(BackendStatus.safeParse(status).success).toBe(true);
		expect(status.usable).toBe(false);
	});

	test("dispose is idempotent and silences the catalog", async () => {
		const { backend, events } = await skeleton();
		await backend.dispose();
		await backend.dispose();
		expect(events).toEqual([]);
	});
});
