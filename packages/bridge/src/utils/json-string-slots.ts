/**
 * The string slots of a JSON-shaped value: where the bytes of a payload actually are, and how to
 * take some of them away. Shared by the two places that must shrink a reply to fit a link frame —
 * a runtime event that cannot be dropped, and a transcript message too large for any page.
 */

/** Nesting after this is not where a huge payload lives, and walking it costs more than it saves. */
const MAX_DEPTH = 8;

export type StringSlot = { path: Array<string | number>; length: number };

export function truncationMarker(bytes: number): string {
	return `…[truncated by the bridge: ${bytes} bytes]`;
}

export function largestString(value: unknown, path: Array<string | number> = [], depth = 0): StringSlot | null {
	if (typeof value === "string") return { path, length: value.length };
	if (depth >= MAX_DEPTH || value === null || typeof value !== "object") return null;
	const entries: Array<[string | number, unknown]> = Array.isArray(value)
		? value.map((item, index) => [index, item])
		: Object.entries(value);
	let best: StringSlot | null = null;
	for (const [key, item] of entries) {
		const found = largestString(item, [...path, key], depth + 1);
		if (found && (best === null || found.length > best.length)) best = found;
	}
	return best;
}

export function readAt(root: unknown, path: Array<string | number>): unknown {
	let current = root;
	for (const key of path) {
		if (current === null || typeof current !== "object") return undefined;
		current = (current as Record<string | number, unknown>)[key];
	}
	return current;
}

export function writeAt(root: unknown, path: Array<string | number>, value: string): void {
	if (path.length === 0) return;
	const parent = readAt(root, path.slice(0, -1));
	if (parent === null || typeof parent !== "object") return;
	(parent as Record<string | number, unknown>)[path[path.length - 1]!] = value;
}

/** Cuts roughly `remove` characters off the longest string, marking the cut. */
export function cutLargestString(root: unknown, remove: number): boolean {
	const slot = largestString(root);
	if (!slot) return false;
	const text = readAt(root, slot.path);
	if (typeof text !== "string") return false;
	const removed = Math.max(1, Math.min(text.length, remove));
	writeAt(root, slot.path, `${text.slice(0, text.length - removed)}${truncationMarker(removed)}`);
	return true;
}
