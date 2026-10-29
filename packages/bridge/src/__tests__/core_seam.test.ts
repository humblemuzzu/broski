import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonValue } from "../contract";
import { createFakeBackend } from "../contract/testing/fake-backend";
import { createContractSeam } from "../server/contract-seam";
import { ManualClock } from "./helpers/core-rig";

const LOG = { logInfo: () => {}, logError: () => {} };
const LIMITS = { linkMessageLimitBytes: 8 * 1024 * 1024 };
const QUEUE = { sendPayload: () => {} };
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function seam(backends: Parameters<typeof createContractSeam>[0]) {
	const root = mkdtempSync(join(tmpdir(), "broski-seam-"));
	roots.push(root);
	return createContractSeam(
		{ ...backends, clock: new ManualClock(), promptJournalPath: join(root, "prompts.jsonl") },
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
