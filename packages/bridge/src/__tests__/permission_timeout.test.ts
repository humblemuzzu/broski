/**
 * The approval timeout used to be a `const` inside `createBridgeServer`, unreachable from a test.
 * It is now an option (`BridgeServerOptions.permissionTimeoutMs`) backed by an exported default,
 * so these tests lock both the default and the actual wait behaviour.
 */
import { describe, expect, test } from "bun:test";
import { PERMISSION_TIMEOUT_MS } from "../server";
import { DEFAULT_PERMISSION_TIMEOUT_MS, type PermissionWaiter, waitForPermission } from "../server/permission-waiter";

describe("permission timeout", () => {
	/**
	 * The assertion that matters is the lower bound: it proves the injected timeout was waited out.
	 * The upper bound only has to rule out the 600_000 ms default, so it stays far above any
	 * scheduling delay a loaded machine can add.
	 */
	const INJECTED_TIMEOUT_UPPER_BOUND_MS = 5_000;

	test("the default is 600_000 ms and matches the server's exported constant", () => {
		expect(DEFAULT_PERMISSION_TIMEOUT_MS).toBe(600_000);
		expect(PERMISSION_TIMEOUT_MS).toBe(DEFAULT_PERMISSION_TIMEOUT_MS);
	});

	test("a parked waiter resolves with its timeout value when the deadline passes", async () => {
		const waiters = new Map<string, PermissionWaiter<{ response: "reject" }>>();
		const started = Date.now();
		const result = await waitForPermission(waiters, "approval-1", 80, { response: "reject" });
		const elapsed = Date.now() - started;

		expect(result).toEqual({ response: "reject" });
		expect(elapsed).toBeGreaterThanOrEqual(60);
		expect(elapsed).toBeLessThan(INJECTED_TIMEOUT_UPPER_BOUND_MS);
		expect(waiters.has("approval-1")).toBe(false);
	});
});
