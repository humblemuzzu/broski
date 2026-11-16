/**
 * Adapter README D28 through the assembled backend: a session a terminal `claude` holds, quiet for longer than the
 * 10 s write window, opens watch-only and no second `claude` is started on it, and its row carries the status the
 * CLI's register gives it. Without a register entry the same session is resumed in a host of the bridge's own, over
 * the real CLI against a scripted endpoint.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeCodeBackendFactory } from "../../../backends/claude-code/factory";
import type { QueryParams } from "../../../backends/claude-code/ports";
import { processStart } from "../../../backends/claude-code/terminal/cli-processes";
import type { AgentBackend, CatalogEvent } from "../../../contract";
import { CatalogRecorder, SessionRecorder } from "../../../contract/testing/conformance-harness";
import { type ClaudeHome, claudeTestEnv, createClaudeHome } from "../../helpers/claude-home";
import { serveScriptedAnthropic } from "../../helpers/scripted-anthropic-server";
import { writeFixtureSession } from "../helpers/fixture-transcripts";
import { isolatedClaudeSdk } from "../helpers/isolated-sdk";
import { testClaudeBinary } from "../helpers/test-claude-cli";
import { expectNoOrphans } from "../spike/rig/orphans";

expectNoOrphans();

const CLI_TEST_MS = 60_000;
const WAIT_MS = 15_000;
/** The register's slow sweep (`cli-processes.ts`): a change seen sooner came through its watch. */
const SWEEP_MS = 5_000;

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface World {
	readonly home: ClaudeHome;
	readonly backend: AgentBackend;
	readonly catalog: CatalogRecorder;
	/** Every `claude` the backend started. */
	readonly started: QueryParams[];
	readonly sessionId: string;
}

async function world(): Promise<World> {
	const home = createClaudeHome();
	cleanups.push(() => home.cleanup());
	const sessionId = crypto.randomUUID();
	const path = writeFixtureSession(home.configDir, { sessionId, cwd: home.projectDir, prompts: ["hello"] });
	const minuteAgo = new Date(Date.now() - 60_000);
	utimesSync(path, minuteAgo, minuteAgo);
	const server = serveScriptedAnthropic([{ text: ["resumed"] }]);
	cleanups.push(() => server.stop());
	const env = claudeTestEnv({ url: server.url, home, proxy: server.proxyUrl });
	const sdk = isolatedClaudeSdk(env);
	const started: QueryParams[] = [];
	const catalog = new CatalogRecorder(WAIT_MS);
	const backend = await claudeCodeBackendFactory({
		cli: { found: true, path: testClaudeBinary() },
		env,
		stateDir: join(home.root, "broski-state"),
		clientApp: "broski/test",
		sdk: {
			...sdk,
			query: (params) => {
				started.push(params);
				return sdk.query(params);
			},
		},
	})({ catalog });
	cleanups.push(() => backend.dispose());
	return { home, backend, catalog, started, sessionId };
}

/** A process standing in for the terminal `claude`, and its register entry as CLI 2.1.325 writes it. */
async function terminalClaude(w: World, status: string): Promise<(status: string) => Promise<void>> {
	const child = Bun.spawn(["sleep", "120"]);
	cleanups.push(() => child.kill());
	const procStart = await processStart(child.pid);
	const dir = join(w.home.configDir, "sessions");
	mkdirSync(dir, { recursive: true });
	const write = async (now: string) => {
		const entry = {
			pid: child.pid,
			sessionId: w.sessionId,
			cwd: w.home.projectDir,
			startedAt: Date.now(),
			procStart,
			version: "2.1.325",
			kind: "interactive",
			entrypoint: "cli",
			status: now,
			updatedAt: Date.now(),
			statusUpdatedAt: Date.now(),
		};
		writeFileSync(join(dir, `${child.pid}.json`), JSON.stringify(entry));
	};
	await write(status);
	return write;
}

function rowOf(w: World, status: string) {
	return (events: readonly CatalogEvent[]) =>
		events.find(
			(event) =>
				event.type === "session_updated" &&
				event.summary.session.sessionId === w.sessionId &&
				event.summary.status === status,
		);
}

describe("a session a terminal claude holds", () => {
	test(
		"opens watch-only during a quiet stretch, starts no second claude, and lists with the terminal's status",
		async () => {
			const w = await world();
			const setStatus = await terminalClaude(w, "busy");
			const ref = { backend: "claude-code" as const, sessionId: w.sessionId };

			const opened = await w.backend.open({ kind: "existing", session: ref }, new SessionRecorder(WAIT_MS));
			expect(opened.status).toBe("accepted");
			if (opened.status !== "accepted") return;
			expect(opened.session.control).toBeUndefined();
			expect(w.started).toEqual([]);

			const got = await w.backend.getSession(ref);
			expect(got.status === "accepted" && got.summary.status).toBe("running");
			const changedAt = Date.now();
			await setStatus("waiting");
			await w.catalog.waitFor(rowOf(w, "waiting_for_user"), "the row to wait for the user");
			expect(Date.now() - changedAt).toBeLessThan(SWEEP_MS);
			await setStatus("idle");
			await w.catalog.waitFor(rowOf(w, "idle"), "the row to go idle");
			await opened.session.close();
		},
		CLI_TEST_MS,
	);

	test(
		"with no terminal in the register, the quiet session is resumed in the bridge's own host",
		async () => {
			const w = await world();
			const ref = { backend: "claude-code" as const, sessionId: w.sessionId };
			const opened = await w.backend.open({ kind: "existing", session: ref }, new SessionRecorder(WAIT_MS));
			expect(opened.status).toBe("accepted");
			if (opened.status !== "accepted") return;
			expect(opened.session.control).toBeDefined();
			expect(w.started).toHaveLength(1);
			const got = await w.backend.getSession(ref);
			expect(got.status === "accepted" && got.summary.status).not.toBe("running");
			await opened.session.close();
		},
		CLI_TEST_MS,
	);
});
