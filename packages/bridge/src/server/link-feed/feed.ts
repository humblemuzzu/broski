import type { ServerWebSocket } from "bun";
import type { CoreObserver } from "../../core/observer";
import { wellFormedJson } from "../../core/well-formed-json";
import { LINK_OVERFLOW_CLOSE_CODE } from "../../transport/send-limits";
import type { ContractAnswerer } from "./contract-decision";
import { ContractFeedTap } from "./contract-tap";
import { createLinkDecisionApplier, type LinkDecisionApplier, parseLinkDecision } from "./decision";
import { busyMessage, LINK_FEED_PONG } from "./format";
import { LinkFeedRequests } from "./requests";
import { LinkRunsTracker } from "./runs";
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
		status = feed.send(wellFormedJson(payload));
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
const runs = new LinkRunsTracker(sendToFeed);
const contractTap = new ContractFeedTap(tracker);

/** What the bridge core tells the feed of every open contract session. */
export const contractFeedObserver: CoreObserver = {
	observe: (observed) => {
		contractTap.observe(observed);
		runs.observe(observed);
	},
	observeCatalog: (event) => {
		runs.observeCatalog(event);
	},
};

/** Forgets every tracked session, request and timer. */
export function resetLinkFeed(): void {
	tracker.reset();
	runs.reset();
	contractTap.reset();
}

/** Sends the daemon's decisions to the core (`ContractSeam.answer`), as a person's answers. */
export function attachLinkDecisionPath(answer: ContractAnswerer): void {
	applyDecision = createLinkDecisionApplier(requests, answer);
}

/** The daemon's feed, the one connection that sees every open session instead of a device's view. */
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
	const currentRuns = runs.current();
	if (currentRuns.runs.length > 0) sendToFeed(currentRuns);
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
	if (frame.type === "link_decision" && applyDecision) void applyDecisionFrame(applyDecision, frame);
}

async function applyDecisionFrame(apply: LinkDecisionApplier, frame: Record<string, unknown>): Promise<void> {
	const decision = parseLinkDecision(frame);
	if (!decision) return;
	const outcome = await apply(decision);
	sendToFeed({
		type: "link_decision_result",
		request: decision.request,
		ok: outcome.ok,
		error: outcome.error,
	});
}
