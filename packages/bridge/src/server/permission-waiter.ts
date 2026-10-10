/**
 * Approval/permission timeouts. A waiter parked in one of the bridge's waiter maps is resolved
 * with its timeout value by `waitForPermission`, so a screen that never answers cannot leak a
 * promise forever.
 */

export type PermissionWaiter<T> = {
	resolve: (value: T) => void;
	timer: Timer;
};

/** 10 minutes: long enough for background → resume → approve on a slow network. */
export const DEFAULT_PERMISSION_TIMEOUT_MS = 600_000;

export function waitForPermission<T>(
	waiters: Map<string, PermissionWaiter<T>>,
	key: string,
	timeoutMs: number,
	timeoutValue: T,
): Promise<T> {
	return new Promise<T>((resolve) => {
		const timer = setTimeout(() => {
			waiters.delete(key);
			resolve(timeoutValue);
		}, timeoutMs);
		waiters.set(key, { resolve, timer });
	});
}
