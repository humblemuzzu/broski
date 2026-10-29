import type { JsonValue, ServerMessage } from "../contract";
import { frameBytes } from "../transport/send-limits";

/** The old protocol shares the socket, and two of its types (`abort`, `error`) are also contract types. */
export const CONTRACT_FRAME_TYPE = "contract";

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
}

export function encodeFrame(message: ServerMessage | JsonValue): EncodedFrame {
	const text = `{"type":"${CONTRACT_FRAME_TYPE}","message":${JSON.stringify(message)}}`;
	return { text, bytes: frameBytes(text) };
}
