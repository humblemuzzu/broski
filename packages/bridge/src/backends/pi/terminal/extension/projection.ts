// The few fields of Pi's events the link sends, cut to size.

export const MAX_TEXT = 256 * 1024;
const MAX_LEAF = 64 * 1024;

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type Frame = { [key: string]: Json };

export function clip(text: string, max: number): string {
	return text.length > max ? text.slice(0, max) : text;
}

export function compact(value: unknown, depth = 0): Json {
	if (typeof value === "string") return clip(value, MAX_LEAF);
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "boolean" || value === null) return value;
	if (typeof value !== "object" || depth >= 6) return null;
	if (Array.isArray(value)) return value.slice(0, 200).map((item) => compact(item, depth + 1));
	const out: { [key: string]: Json } = Object.create(null);
	let kept = 0;
	for (const [key, item] of Object.entries(value)) {
		if (kept++ >= 100) break;
		if (item !== undefined) out[key] = compact(item, depth + 1);
	}
	return out;
}

export function read(value: unknown, key: string): unknown {
	return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

export function textOf(content: unknown): string {
	if (typeof content === "string") return clip(content, MAX_TEXT);
	if (!Array.isArray(content)) return "";
	const parts = content.flatMap((block) => (read(block, "type") === "text" ? [String(read(block, "text") ?? "")] : []));
	return clip(parts.join("\n"), MAX_TEXT);
}

export function toolResult(result: unknown): Frame {
	const content = read(result, "content");
	const blocks: Json[] = Array.isArray(content)
		? content.slice(0, 100).flatMap((block): Json[] => {
				if (read(block, "type") === "text")
					return [{ type: "text", text: clip(String(read(block, "text") ?? ""), MAX_LEAF) }];
				if (read(block, "type") === "image")
					return [{ type: "image", mimeType: String(read(block, "mimeType") ?? "image"), data: "" }];
				return [];
			})
		: [];
	const details = read(result, "details");
	return { content: blocks, ...(details !== undefined && { details: compact(details) }) };
}

function imageSlots(content: unknown): Json[] {
	if (!Array.isArray(content)) return [];
	const slots: Json[] = [];
	content.slice(0, 100).forEach((block, index) => {
		if (read(block, "type") === "image") {
			slots.push({ index, mimeType: clip(String(read(block, "mimeType") ?? "image/png"), 1_024) });
		}
	});
	return slots;
}

export function endedMessage(message: unknown): Frame {
	const role = read(message, "role");
	if (role === "user") {
		const content = read(message, "content");
		const timestamp = read(message, "timestamp");
		const images = imageSlots(content);
		return {
			role,
			text: textOf(content),
			...(typeof timestamp === "number" && Number.isFinite(timestamp) && { timestamp }),
			...(images.length > 0 && { images }),
		};
	}
	if (role === "toolResult") {
		const timestamp = read(message, "timestamp");
		return {
			role,
			toolCallId: clip(String(read(message, "toolCallId") ?? ""), 256),
			toolName: clip(String(read(message, "toolName") ?? ""), 1_024),
			isError: read(message, "isError") === true,
			...(typeof timestamp === "number" && Number.isFinite(timestamp) && { timestamp }),
			result: toolResult(message),
		};
	}
	if (role === "custom") {
		const details = read(message, "details");
		return {
			role,
			customType: clip(String(read(message, "customType") ?? ""), 1_024),
			display: read(message, "display") === true,
			text: textOf(read(message, "content")),
			...(details !== undefined && { details: compact(details) }),
		};
	}
	if (role !== "assistant") return { role: "other" };
	const content = read(message, "content");
	const blocks = (Array.isArray(content) ? content : []).flatMap((block): Json[] => {
		const type = read(block, "type");
		if (type === "text") return [{ type, text: clip(String(read(block, "text") ?? ""), MAX_TEXT) }];
		if (type === "thinking") return [{ type, thinking: clip(String(read(block, "thinking") ?? ""), MAX_TEXT) }];
		if (type !== "toolCall") return [];
		return [
			{
				type,
				id: String(read(block, "id")),
				name: String(read(block, "name") ?? ""),
				arguments: compact(read(block, "arguments")),
			},
		];
	});
	const errorMessage = read(message, "errorMessage");
	return {
		role,
		content: blocks,
		stopReason: String(read(message, "stopReason") ?? "stop"),
		provider: String(read(message, "provider") ?? "unknown"),
		...(typeof errorMessage === "string" && { errorMessage: clip(errorMessage, MAX_TEXT) }),
	};
}
