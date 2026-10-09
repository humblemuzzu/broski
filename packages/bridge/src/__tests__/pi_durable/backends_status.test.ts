import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("pi-durable backends status", () => {
	test("derives pi-durable availability from the shared probe", () => {
		const src = readFileSync(join(import.meta.dir, "..", "..", "server.ts"), "utf8");
		expect(src).toContain("piDurable.piDurableAvailability()");

		const start = src.indexOf('"pi-durable": {');
		expect(start).toBeGreaterThan(-1);
		const block = src.slice(start, start + 200);
		expect(block).toContain("piDurableStatus");
		expect(block).not.toContain("piStatus");
	});
});
