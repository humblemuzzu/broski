import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonValue } from "../contract";
import { createFakeBackend } from "../contract/testing/fake-backend";
import { DEFAULT_IDLE_CLOSE_MS } from "../core/keep-open";
import { createContractSeam } from "../server/contract-seam";
import { type OpenRecord, recordingOpens } from "./helpers/core-adapters";
import { ManualClock } from "./helpers/core-rig";

const LOG = { logInfo: () => {}, logError: () => {} };
const LIMITS = { linkMessageLimitBytes: 8 * 1024 * 1024 };
const QUEUE = { sendPayload: () => {} };
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function seam(backends: Parameters<typeof createContractSeam>[0], clock = new ManualClock()) {
	const root = mkdtempSync(join(tmpdir(), "broski-seam-"));
	roots.push(root);
	return createContractSeam(
		{ ...backends, clock, journalDirectory: join(root, "journals") },
		"0.0.0-test",
		QUEUE,
		LIMITS,
		LOG,
	);
}

describe("the contract seam", () => {
	test("claims exactly the frames of type contract", () => {
		const contract = seam({});
		expect(contract.owns({ type: "contract", message: {} })).toBe(true);
		const others: JsonValue[] = [{ type: "abort" }, { message: {} }, ["contract"], null, "contract", 1];
		for (const frame of others) {
			expect(contract.owns(frame)).toBe(false);
		}
	});

	test("holds and releases a session of a backend it serves, and refuses one of a backend it does not", async () => {
		let fake: ReturnType<typeof createFakeBackend> | undefined;
		const opens: OpenRecord = { opened: [], closed: [] };
		const clock = new ManualClock();
		const factory = async (host: Parameters<typeof createFakeBackend>[0]) => {
			fake = createFakeBackend(host);
			return recordingOpens(fake, opens);
		};
		const contract = seam({ backends: [["pi", factory]] }, clock);
		contract.start();
		await Bun.sleep(0);
		if (!fake) throw new Error("the backend did not start");
		const session = fake.fake.seed({ cwd: "/fake/project" });
		expect(await contract.hold(session)).toEqual({ status: "accepted" });
		clock.advance(DEFAULT_IDLE_CLOSE_MS);
		expect(opens.closed).toEqual([]);
		contract.release(session);
		clock.advance(DEFAULT_IDLE_CLOSE_MS);
		await Bun.sleep(0);
		expect(opens.closed).toEqual([session.sessionId]);
		const refused = await contract.hold({ backend: "claude-code", sessionId: "s" });
		expect(refused.status === "rejected" && refused.rejection.code).toBe("not_found");
		await contract.stop();
	});

	test("refuses a backend configured twice before anything starts", () => {
		let made = 0;
		const factory = async (host: Parameters<typeof createFakeBackend>[0]) => {
			made += 1;
			return createFakeBackend(host);
		};
		expect(() =>
			seam({
				backends: [
					["pi", factory],
					["pi", factory],
				],
			}),
		).toThrow("configured twice");
		expect(made).toBe(0);
	});
});
