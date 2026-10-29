import { CONTRACT_FRAME_PREFIX, encodeFrame } from "../../src/core/frame";

/**
 * How a contract frame begins on the wire, and one frame the core itself encoded, so the app's test
 * holds its reading of the prefix to what the bridge writes.
 */
export function framePrefix(): { prefix: string; example: string } {
	const example = encodeFrame({ type: "session.detach.result", requestId: "r" }).text;
	if (!example.startsWith(CONTRACT_FRAME_PREFIX)) throw new Error("the core wrote a frame without its prefix");
	return { prefix: CONTRACT_FRAME_PREFIX, example };
}
