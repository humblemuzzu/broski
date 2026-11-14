import { afterAll, beforeAll, expect } from "bun:test";
import { testClaudeBinary } from "../../helpers/test-claude-cli";
import { processesOf, waitForNoNewProcesses } from "./processes";

/** Fails the file if any `claude` process it started is still alive once every test has closed its query. */
export function expectNoOrphans(): void {
	const binary = testClaudeBinary();
	let before: number[] = [];
	beforeAll(() => {
		before = processesOf(binary);
	});
	afterAll(async () => {
		expect(await waitForNoNewProcesses(binary, before)).toEqual([]);
	}, 15_000);
}
