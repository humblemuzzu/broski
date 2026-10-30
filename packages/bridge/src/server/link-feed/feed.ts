import type { ServerWebSocket } from "bun";
import type { CoreObserver } from "../../core/observer";
import type { RouteRegistry } from "../../routing/registry";
import type { ServerDeps } from "../../routing/types";
import { LINK_OVERFLOW_CLOSE_CODE } from "../../transport/send-limits";
import type { BroskiRuntimeEvent } from "../../types/runtime";
import type { ContractAnswerer } from "./contract-decision";
import { ContractFeedTap } from "./contract-tap";
import { createLinkDecisionApplier, type LinkDecisionApplier, parseLinkDecision } from "./decision";
import { busyMessage, LINK_FEED_PONG } from "./format";
import { LinkFeedRequests } from "./requests";
import { LinkFeedTracker } from "./tracker";

/** A health check or a decision fits well inside this; anything longer is not a feed frame. */
const MAX_FEED_MESSAGE_BYTES = 1024;

const LINK_FEED_OVERFLOW_CLOSE_REASON = "link feed frame dropped";

let activeFeed: ServerWebSocket<unknown> | null = null;
let applyDecision: LinkDecisionApplier | null = null;
let logFeed: (message: string) => void = () => {};

/**
 * A feed frame that does not fit is never held: Bun answers `0` (dropped) or `-1`
 * (over `backpressureLimit`) and the daemon would lose the alert without a word, so the feed is
 * closed instead and its owner redials with a clean one.
 */
function sendToFeed(payload: unknown): void {
	const feed = activeFeed;
	if (!feed) return;
	let status = 0;
	try {
		status = feed.send(JSON.stringify(payload));
	} catch {
		status = 0;
	}
	if (status > 0) return;
	logFeed(`[Link] Closing the daemon feed: a frame was dropped (${LINK_FEED_OVERFLOW_CLOSE_REASON})`);
	activeFeed = null;
	try {
		feed.close(LINK_OVERFLOW_CLOSE_CODE, LINK_FEED_OVERFLOW_CLOSE_REASON);
	} catch {
		// already closed
	}
}

const requests = new LinkFeedRequests();
const tracker = new LinkFeedTracker(sendToFeed, requests);
const contractTap = new ContractFeedTap(tracker);

/** What the bridge core tells the feed of every open contract session. */
export const contractFeedObserver: CoreObserver = { observe: (observed) => contractTap.observe(observed) };

/** Forgets every tracked session, request and timer. */
export function resetLinkFeed(): void {
	tracker.reset();
	contractTap.reset();
}

/** Routes the daemon's decisions through the registry the phone's own messages are dispatched to. */
export function attachLinkDecisionPath(
	registry: RouteRegistry,
	serverDeps: ServerDeps,
	contractAnswer: ContractAnswerer,
): void {
	applyDecision = createLinkDecisionApplier({ registry, serverDeps, requests, contractAnswer });
}

/** The daemon's feed, the one connection that sees runtime activity instead of a device's view. */
export function attachLinkFeed(ws: ServerWebSocket<unknown>, log?: (message: string) => void): void {
	if (log) logFeed = log;
	const previous = activeFeed;
	if (previous && previous !== ws) {
		try {
			previous.close(4001, "Replaced by a newer daemon feed");
		} catch {
			// already closed
		}
	}
	activeFeed = ws;
	sendToFeed(busyMessage(tracker.currentBusy()));
	tracker.replayPending();
}

export function detachLinkFeed(ws: ServerWebSocket<unknown>): void {
	if (activeFeed === ws) activeFeed = null;
}

export function handleLinkFeedMessage(ws: ServerWebSocket<unknown>, raw: string | Uint8Array): void {
	if (ws !== activeFeed || typeof raw !== "string" || raw.length > MAX_FEED_MESSAGE_BYTES) return;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
	const frame = parsed as Record<string, unknown>;
	if (frame.type === "link_feed_ping") {
		sendToFeed(LINK_FEED_PONG);
		return;
	}
	if (frame.type === "link_decision" && applyDecision) void applyDecisionFrame(applyDecision, ws, frame);
}

/** The one entry point every backend's runtime events reach the feed through. */
export function tapRuntimeEvent(event: BroskiRuntimeEvent): void {
	tracker.handle(event);
}

async function applyDecisionFrame(
	apply: LinkDecisionApplier,
	ws: ServerWebSocket<unknown>,
	frame: Record<string, unknown>,
): Promise<void> {
	const decision = parseLinkDecision(frame);
	if (!decision) return;
	const outcome = await apply(decision, ws);
	sendToFeed({
		type: "link_decision_result",
		request: decision.request,
		ok: outcome.ok,
		error: outcome.error,
	});
}
