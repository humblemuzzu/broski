import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RotatingFileWriter } from "../logging/rotating-file";

function openFdCount(): number {
	return readdirSync("/dev/fd").length;
}

describe("RotatingFileWriter descriptor handling", () => {
	test("uses its size probe and does not leak the descriptor when the probe fails", () => {
		const dir = mkdtempSync(join(tmpdir(), "broski-fd-"));
		const path = join(dir, "bridge.log");
		const before = openFdCount();

		let probes = 0;
		const attempts = 25;
		for (let i = 0; i < attempts; i++) {
			const writer = new RotatingFileWriter({
				path,
				sizeOf: () => {
					probes++;
					throw new Error("probe failed");
				},
			});
			writer.write("line\n");
		}

		expect(probes).toBe(attempts);
		expect(openFdCount()).toBeLessThanOrEqual(before + 2);
	});
});
