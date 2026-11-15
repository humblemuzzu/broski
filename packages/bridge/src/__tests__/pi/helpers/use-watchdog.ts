import { afterAll, beforeAll, setDefaultTimeout } from "bun:test";
import { armWatchdog, type Watchdog } from "./memory-watchdog";

/** A test that starts several real `pi` processes and runs them through scripted turns. */
const PI_TEST_TIMEOUT_MS = 60_000;

/** Arms the watchdog for the test file that calls it, from its first test to its last, and gives each test the time a real `pi` needs. */
export function useWatchdog(): void {
	setDefaultTimeout(PI_TEST_TIMEOUT_MS);
	let watchdog: Watchdog | undefined;
	beforeAll(() => {
		watchdog = armWatchdog();
	});
	afterAll(() => {
		watchdog?.disarm();
		watchdog = undefined;
	});
}
