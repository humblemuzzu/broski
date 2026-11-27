/**
 * A test on the real `agy` that fails at its own deadline, ahead of bun's, so its catch always runs: it prints the wire
 * of every open world (`world.ts`) since the test began and the tails of agy's own logs there, as the world's temp
 * folders, the tap's logs and agy's among them, go with the world, then ends every open world's turns before the next
 * test starts, so nothing it left with agy holds the account's turn (`AgyWorld.endTurns`).
 */

import { test } from "bun:test";
import { ENDING_MS } from "./gate";
import { AgyWorld } from "./world";

export function liveTest(name: string, body: () => Promise<void>, timeoutMs: number): void {
	test(
		name,
		async () => {
			const since = Date.now();
			try {
				await byDeadline(body(), timeoutMs, `"${name}" ran past its ${timeoutMs} ms`);
			} catch (error) {
				for (const report of AgyWorld.reportsSince(since)) console.log(`"${name}" failed; ${report}`);
				await AgyWorld.endTurns().catch((ending: unknown) => {
					console.log(`"${name}" could not end its turns: ${String(ending)}`);
				});
				throw error;
			}
		},
		timeoutMs + ENDING_MS,
	);
}

function byDeadline(work: Promise<void>, ms: number, late: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(late)), ms);
		work.then(resolve, reject).finally(() => clearTimeout(timer));
	});
}
