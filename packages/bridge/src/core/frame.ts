import type { JsonValue, ServerMessage } from "../contract";
import { frameBytes } from "../transport/send-limits";

/** The old protocol shares the socket, and two of its types (`abort`, `error`) are also contract types. */
export const CONTRACT_FRAME_TYPE = "contract";

/**
 * How every frame the core sends begins, to the character: the app tells a contract frame from the old
 * protocol's by it before it reads the JSON, so it can read a large one off its UI thread.
 */
export const CONTRACT_FRAME_PREFIX = `{"type":"${CONTRACT_FRAME_TYPE}","message":`;

/** Unchecked: `ClientMessage` checks it with each field's bounds, and a prompt's images exceed free JSON's. */
export function framedMessage(frame: JsonValue): JsonValue | undefined {
	if (frame === null || typeof frame !== "object" || Array.isArray(frame)) return undefined;
	const keys = Object.keys(frame);
	const wellFormed = keys.length === 2 && frame.type === CONTRACT_FRAME_TYPE && keys.includes("message");
	return wellFormed ? frame.message : undefined;
}

export interface EncodedFrame {
	readonly text: string;
	/** UTF-8, as the link counts. */
	readonly bytes: number;
	/**
	 * What a client that speaks less than `minor` is sent in this frame's place (contract README §12.4); that frame's own
	 * `instead`, of a lower minor, serves a client older still.
	 */
	readonly instead?: { readonly minor: number; readonly frame: EncodedFrame };
}

export function encodeFrame(message: ServerMessage | JsonValue): EncodedFrame {
	const text = `${CONTRACT_FRAME_PREFIX}${JSON.stringify(message)}}`;
	return { text, bytes: frameBytes(text) };
}
