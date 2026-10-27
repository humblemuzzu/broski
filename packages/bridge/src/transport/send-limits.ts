/**
 * How far behind a socket may fall before the bridge acts, and what it says when it does.
 *
 * A phone on the network is shed at 4 MiB: the app reconnects and resyncs, and a resync is cheap.
 * A link socket has no app on the other end — its peer is the daemon, which holds its own 8 MiB
 * window for the phone and stops reading this socket once that window is full. Stopping reading is
 * therefore the daemon's normal behaviour, not a fault: a link socket gets a far wider window of its
 * own and is only ever closed for a real overflow, with an application close code.
 */

export type SendLimits =
	| { kind: "network"; maxPendingBytes: number; maxPendingFrames: number }
	| {
			kind: "link";
			maxPendingBytes: number;
			maxPendingFrames: number;
			/** Largest single frame the peer will accept whole. */
			maxMessageBytes: number;
	  };

/** Per socket, this much unsent data means a phone on the network is not reading any more. */
const NETWORK_MAX_PENDING_BYTES = 4 * 1024 * 1024;
/** Second guard, in case frames are tiny. */
const NETWORK_MAX_PENDING_FRAMES = 4096;

export const NETWORK_SEND_LIMITS: SendLimits = {
	kind: "network",
	maxPendingBytes: NETWORK_MAX_PENDING_BYTES,
	maxPendingFrames: NETWORK_MAX_PENDING_FRAMES,
};

/** 1013 is the network's "backpressure"; a link socket closes with an application code instead. */
export const LINK_OVERFLOW_CLOSE_CODE = 4013;
export const LINK_OVERFLOW_CLOSE_REASON = "link overflow";

export const RESPONSE_TOO_LARGE_CODE = "response_too_large";
export const RESPONSE_TOO_LARGE_MESSAGE = "Response too large for the link; request a smaller page";

export type ResponseTooLargeFrame = {
	type: "error";
	code: typeof RESPONSE_TOO_LARGE_CODE;
	requestId?: string;
	bytes: number;
	limit: number;
	message: string;
};

/**
 * What a link socket gets instead of a reply it could never take whole. It carries the requester's
 * `requestId`, so the phone matches it to the request it made and can retry with a smaller page.
 */
export function responseTooLargeFrame(
	requestId: string | undefined,
	bytes: number,
	limit: number,
): ResponseTooLargeFrame {
	return {
		type: "error",
		code: RESPONSE_TOO_LARGE_CODE,
		requestId,
		bytes,
		limit,
		message: RESPONSE_TOO_LARGE_MESSAGE,
	};
}

/** UTF-8 length of a frame, which is what every peer counts; `length` counts UTF-16 units. */
export function frameBytes(payload: string | Uint8Array): number {
	return typeof payload === "string" ? Buffer.byteLength(payload, "utf8") : payload.byteLength;
}
