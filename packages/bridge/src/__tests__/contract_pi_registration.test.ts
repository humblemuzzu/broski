/**
 * The bridge core serves Pi: a real bridge serves it to a phone on its link socket beside the old protocol.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BackendStatus } from "../contract";
import { contractOptions } from "../server/contract-backends";
import { E2E_TEST_TIMEOUT_MS, startBridge } from "./e2e/harness";
import { connectPhone } from "./helpers/link-contract-client";
import { createPiTestEnv, type PiTestEnv } from "./pi/helpers/pi-test-env";

let env: PiTestEnv | undefined;

afterEach(() => {
	env?.dispose();
	env = undefined;
});

describe("which backends the core serves", () => {
	test("pi", () => {
		expect((contractOptions().backends ?? []).map(([id]) => id)).toEqual(["pi"]);
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
				contract: { ...contractOptions(), journalDirectory: join(env.root, "journals") },
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
						"export_session",
						"export_part",
						"import_session",
						"changed_files",
						"refresh_models",
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
