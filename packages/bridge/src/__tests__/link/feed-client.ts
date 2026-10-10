/**
 * Shared plumbing for the daemon-feed tests: a feed connection, the waits their assertions use, and
 * the tracker's timing windows.
 */

import { linkFeedTiming } from "../../server/link-feed/tracker";
import { connectUnixWs, type LinkFrame, type UnixWsClient, type UnixWsClose } from "./unix-ws";

export const DAEMON_HEADERS = { "x-broski-role": "link-daemon" };

export async function connectFeed(socketPath: string): Promise<UnixWsClient> {
	const feed = await connectUnixWs(socketPath, DAEMON_HEADERS);
	await feed.waitFor("link_busy");
	return feed;
}

/** As `connectFeed`, with the frame sent on connect dropped so a later wait cannot match it. */
export async function openFeed(socketPath: string): Promise<UnixWsClient> {
	const feed = await connectFeed(socketPath);
	feed.clear();
	return feed;
}

export function busyFrame(feed: UnixWsClient, value: boolean, timeoutMs?: number): Promise<LinkFrame> {
	return feed.waitForWhere((frame) => frame.type === "link_busy" && frame.busy === value, `busy=${value}`, timeoutMs);
}

export async function alertsOf(feed: UnixWsClient, count: number): Promise<LinkFrame[]> {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		const found = feed.frames().filter((frame) => frame.type === "link_event");
		if (found.length >= count) return found;
		await Bun.sleep(10);
	}
	throw new Error(`only ${feed.frames().filter((frame) => frame.type === "link_event").length} alerts arrived`);
}

export async function waitForClose(feed: UnixWsClient, timeoutMs = 5000): Promise<UnixWsClose> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const closed = feed.closed();
		if (closed) return closed;
		await Bun.sleep(10);
	}
	throw new Error("the feed socket never closed");
}

const DEFAULT_TIMING = { ...linkFeedTiming };

/**
 * The tracker outlives a test file, so the work must be finished while the short windows are still
 * in force; `finishFeed` is what puts them back.
 */
export function shortTiming(): () => void {
	linkFeedTiming.busyIdleDebounceMs = 60;
	linkFeedTiming.doneIdleMs = 100;
	return () => {
		linkFeedTiming.busyIdleDebounceMs = DEFAULT_TIMING.busyIdleDebounceMs;
		linkFeedTiming.doneIdleMs = DEFAULT_TIMING.doneIdleMs;
	};
}

async function settle(): Promise<void> {
	await Bun.sleep(linkFeedTiming.doneIdleMs + linkFeedTiming.busyIdleDebounceMs + 80);
}

/** Closes the feed, waits out the tracker's pending timers, then restores the timing. */
export async function finishFeed(feed: UnixWsClient | null, restoreTiming: () => void): Promise<void> {
	feed?.close();
	await settle();
	restoreTiming();
}
