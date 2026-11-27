/**
 * A test on the real `agy` that, when it fails, prints the wire of every open world (`world.ts`) since it began, as
 * the world's temp folders and the tap's logs go with the world. A test bun times out never reaches its own catch, so
 * the wire is printed `TRACED_BEFORE_TIMEOUT_MS` before the timeout as well, the test left to time out as it would.
 */

import { test } from "bun:test";
import { AgyWorld } from "./world";

const TRACED_BEFORE_TIMEOUT_MS = 1_000;

export function liveTest(name: string, body: () => Promise<void>, timeoutMs: number): void {
	test(
		name,
		async () => {
			const since = Date.now();
			const timer = setTimeout(
				() => printWires(name, since, "is about to time out"),
				timeoutMs - TRACED_BEFORE_TIMEOUT_MS,
			);
			try {
				await body();
			} catch (error) {
				printWires(name, since, "failed");
				throw error;
			} finally {
				clearTimeout(timer);
			}
		},
		timeoutMs,
	);
}

function printWires(name: string, since: number, how: string): void {
	for (const wire of AgyWorld.wiresSince(since)) console.log(`"${name}" ${how}; ${wire}`);
}
