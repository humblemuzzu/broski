/**
 * Pi is served through the contract only behind `BROSKI_CONTRACT_PI=1`, never in a compiled binary, and with the
 * flag on a real bridge serves it to a phone on its link socket beside the old protocol.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BackendStatus } from "../contract";
import { CONTRACT_PI_FLAG, contractOptions } from "../server/contract-backends";
import { E2E_TEST_TIMEOUT_MS, startBridge } from "./e2e/harness";
import { connectPhone } from "./helpers/link-contract-client";
import { createPiTestEnv, type PiTestEnv } from "./pi/helpers/pi-test-env";

let env: PiTestEnv | undefined;

afterEach(() => {
	env?.dispose();
	env = undefined;
});

const ids = (env: Record<string, string | undefined>, compiled: boolean) =>
	(contractOptions(env, compiled).backends ?? []).map(([id]) => id);

describe("which backends the core serves", () => {
	test("none without the flag, and none for any value but 1", () => {
		expect(ids({}, false)).toEqual([]);
		for (const value of ["0", "true", "yes", " 1", ""]) expect(ids({ [CONTRACT_PI_FLAG]: value }, false)).toEqual([]);
	});

	test("pi with the flag in a dev bridge", () => {
		expect(ids({ [CONTRACT_PI_FLAG]: "1" }, false)).toEqual(["pi"]);
	});

	test("none in a compiled binary, flag or not", () => {
		expect(ids({ [CONTRACT_PI_FLAG]: "1" }, true)).toEqual([]);
	});
});

describe("a bridge started with the flag", () => {
	async function bridgeWith(flag: string | undefined) {
		env = createPiTestEnv();
		const socketPath = join(env.root, "link.sock");
		const options = contractOptions(flag === undefined ? {} : { [CONTRACT_PI_FLAG]: flag }, false);
		const bridge = await startBridge({
			linkSocket: socketPath,
			contract: { ...options, journalDirectory: join(env.root, "journals") },
		});
		const phone = await connectPhone(socketPath, "phone");
		await phone.hello();
		return { bridge, phone };
	}

	test(
		"serves pi to a phone, with Pi's status from the throwaway agent dir",
		async () => {
			const { bridge, phone } = await bridgeWith("1");
			try {
				const status = await phone.ok("backend.status", { backend: "pi" });
				expect(BackendStatus.safeParse(status.status).success).toBe(true);
				expect(status.status).toMatchObject({ installed: true, auth: "signed_out", usable: false });
				const listed = await phone.ok("backends.list", {});
				expect(listed.backends.map((backend) => backend.id)).toEqual(["pi"]);
				expect(listed.backends[0]?.capabilities).toMatchObject({
					backendOps: ["navigate_tree", "take_over"],
					fork: true,
				});
			} finally {
				await bridge.stop();
			}
		},
		E2E_TEST_TIMEOUT_MS,
	);

	test(
		"serves nothing through the contract without it",
		async () => {
			const { bridge, phone } = await bridgeWith(undefined);
			try {
				expect((await phone.ok("backends.list", {})).backends).toEqual([]);
				expect(await phone.request("backend.status", { backend: "pi" })).toMatchObject({
					type: "error",
					error: { code: "unknown_backend" },
				});
			} finally {
				await bridge.stop();
			}
		},
		E2E_TEST_TIMEOUT_MS,
	);
});
