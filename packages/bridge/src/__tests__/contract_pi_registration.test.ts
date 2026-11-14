/**
 * The bridge core serves Pi and Claude Code; a real bridge serves Pi to a phone on its link socket.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BackendStatus } from "../contract";
import { createClaudeCodeWiring } from "../server/claude-code-wiring";
import { contractOptions } from "../server/contract-backends";
import { E2E_TEST_TIMEOUT_MS, startBridge } from "./e2e/harness";
import { connectPhone } from "./helpers/link-contract-client";
import { createPiTestEnv, type PiTestEnv } from "./pi/helpers/pi-test-env";

let env: PiTestEnv | undefined;

afterEach(() => {
	env?.dispose();
	env = undefined;
});

const wiring = createClaudeCodeWiring({
	settings: { terminalAsks: true },
	cli: () => ({ ok: false, reason: "not needed", notes: [] }),
	version: "0.0.0-test",
	log: () => undefined,
});

describe("which backends the core serves", () => {
	test("pi and Claude Code", () => {
		expect((contractOptions(wiring).backends ?? []).map(([id]) => id)).toEqual(["pi", "claude-code"]);
	});
});

describe("a bridge", () => {
	test(
		"serves pi to a phone, with Pi's status from the throwaway agent dir",
		async () => {
			env = createPiTestEnv();
			const socketPath = join(env.root, "link.sock");
			const bridge = await startBridge({
				linkSocket: socketPath,
				contract: {
					// Claude Code's production factory reads the real home; only Pi runs here, in its throwaway agent dir.
					backends: (contractOptions(wiring).backends ?? []).filter(([id]) => id === "pi"),
					journalDirectory: join(env.root, "journals"),
				},
			});
			const phone = await connectPhone(socketPath, "phone");
			await phone.hello();
			try {
				const status = await phone.ok("backend.status", { backend: "pi" });
				expect(BackendStatus.safeParse(status.status).success).toBe(true);
				expect(status.status).toMatchObject({ installed: true, auth: "signed_out", usable: false });
				const listed = await phone.ok("backends.list", {});
				expect(listed.backends.map((backend) => backend.id)).toEqual(["pi"]);
				expect(listed.backends[0]?.capabilities).toMatchObject({
					backendOps: [
						"navigate_tree",
						"take_over",
						"session_settings",
						"session_tools",
						"system_prompt",
						"export_session",
						"export_part",
						"import_session",
						"changed_files",
						"refresh_models",
						"read_tree",
						"label_entry",
						"abort_branch_summary",
						"run_shell",
					],
					fork: true,
				});
			} finally {
				await bridge.stop();
			}
		},
		E2E_TEST_TIMEOUT_MS,
	);
});
