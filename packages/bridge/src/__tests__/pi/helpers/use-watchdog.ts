import { afterAll, beforeAll } from "bun:test";
import { armWatchdog, type Watchdog } from "./memory-watchdog";

/** Arms the watchdog for the test file that calls it, from its first test to its last. */
export function useWatchdog(): void {
	let watchdog: Watchdog | undefined;
	beforeAll(() => {
		watchdog = armWatchdog();
	});
	afterAll(() => {
		watchdog?.disarm();
		watchdog = undefined;
	});
}
