import { type JsonValue, MAX_NAME_CHARS, MAX_PATH_CHARS } from "../contract";

export type JsonPath = readonly (string | number)[];

/** Where elision may cut: strings under `roots`, keeping their newest text where `keepsTail` says so. */
export interface ElisionScope {
	readonly roots: readonly JsonPath[];
	readonly keepsTail: (path: JsonPath) => boolean;
}

/** How many bytes the encoded tree is over its budget; zero or less when it fits. */
export type Overshoot = (tree: JsonValue) => number;

interface Candidate {
	readonly text: string;
	readonly path: JsonPath;
	/** UTF-8 bytes this string takes in JSON, per UTF-16 unit. */
	readonly bytesPerUnit: number;
	readonly set: (text: string) => void;
}

/** An editable interaction request whose edit (`input` or `plan`) holds candidates. */
interface EditLock {
	readonly request: { [key: string]: JsonValue };
	readonly flag: "inputEditable" | "editable";
	readonly candidates: Candidate[];
}

const ELLIPSIS = "…";
/** A cut string keeps at least this much, enough to say what it was. */
const MIN_KEPT_UNITS = MAX_NAME_CHARS;

/**
 * Cuts free text in `tree`, in place, to the longest common length that fits, found by measuring
 * the encoding; false, with the tree as it was, when even the floor does not fit.
 *
 * Free text is a string longer than `MAX_PATH_CHARS`, which every id, name, option value, path and
 * URL stays within (`limits.ts`). A form field's `when` values stay whole: they decide what the
 * phone shows. An interaction whose editable input or plan was cut is made uneditable, so the phone
 * never sends a cut copy back as the edit.
 */
export function elide(tree: JsonValue, scope: ElisionScope, overshoot: Overshoot): boolean {
	const candidates = scope.roots.flatMap((root) => collect(tree, root));
	const excess = overshoot(tree);
	if (excess <= 0) return true;
	if (candidates.length === 0) return false;
	const locks = editLocks(tree, candidates);
	const overAt = (limit: number): number => {
		for (const candidate of candidates) {
			const cut = candidate.text.length > limit;
			candidate.set(cut ? shorten(candidate.text, limit, scope.keepsTail(candidate.path)) : candidate.text);
		}
		for (const lock of locks) lock.request[lock.flag] = lock.candidates.every((item) => item.text.length <= limit);
		return overshoot(tree);
	};
	const longest = candidates.reduce((most, item) => Math.max(most, item.text.length), 0);
	const limit = largestFitting(candidates, excess, longest, overAt);
	overAt(limit ?? longest);
	return limit !== undefined;
}

/**
 * The largest limit at which `overAt` says the tree fits, knowing it overshoots by `excess` at
 * `longest` (nothing cut); undefined when it does not fit at the floor either. The estimate,
 * corrected by each measured overshoot, finds a limit that fits; between it and the nearest that
 * does not, the overshoot is close to linear, so interpolation closes the gap, with a bisection
 * after any step that did not halve it.
 */
function largestFitting(
	candidates: readonly Candidate[],
	excess: number,
	longest: number,
	overAt: (limit: number) => number,
): number | undefined {
	let failing = longest;
	let failingOver = excess;
	let fitting = Math.min(cutLimit(candidates, excess), failing - 1);
	let fittingOver = overAt(fitting);
	let target = excess;
	while (fittingOver > 0) {
		failing = fitting;
		failingOver = fittingOver;
		if (fitting <= MIN_KEPT_UNITS) return undefined;
		target += fittingOver;
		fitting = Math.max(MIN_KEPT_UNITS, Math.min(cutLimit(candidates, target), fitting - 1));
		fittingOver = overAt(fitting);
	}
	let bisect = false;
	while (failing - fitting > 1) {
		const span = failing - fitting;
		const interpolated = fitting + Math.floor((span * -fittingOver) / (failingOver - fittingOver));
		const probe = bisect ? fitting + Math.floor(span / 2) : Math.min(failing - 1, Math.max(fitting + 1, interpolated));
		const over = overAt(probe);
		if (over <= 0) {
			fitting = probe;
			fittingOver = over;
		} else {
			failing = probe;
			failingOver = over;
		}
		bisect = !bisect && 2 * (failing - fitting) > span;
	}
	return fitting;
}

/** The largest kept length whose estimated savings cover `excess` bytes, never below the floor. */
function cutLimit(candidates: readonly Candidate[], excess: number): number {
	const saved = (limit: number): number =>
		candidates.reduce((sum, item) => sum + Math.max(0, item.text.length - limit) * item.bytesPerUnit, 0);
	let low = MIN_KEPT_UNITS;
	let high = candidates.reduce((longest, item) => Math.max(longest, item.text.length), low);
	if (saved(low) < excess) return low;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (saved(middle) >= excess) low = middle;
		else high = middle - 1;
	}
	return low;
}

function collect(tree: JsonValue, root: JsonPath): Candidate[] {
	const found: Candidate[] = [];
	const visit = (value: JsonValue, path: JsonPath, set: (text: string) => void): void => {
		if (typeof value === "string") {
			if (value.length > MAX_PATH_CHARS && !isCondition(path)) {
				found.push({ text: value, path, bytesPerUnit: jsonBytes(value) / value.length, set });
			}
			return;
		}
		if (Array.isArray(value)) {
			value.forEach((item, index) => {
				visit(item, [...path, index], (text) => {
					value[index] = text;
				});
			});
			return;
		}
		if (value === null || typeof value !== "object") return;
		for (const [key, item] of Object.entries(value)) {
			visit(item, [...path, key], (text) => {
				value[key] = text;
			});
		}
	};
	const start = at(tree, root);
	if (start !== undefined) visit(start, root, () => {});
	return found;
}

/** `text` cut to `limit` UTF-16 units with an ellipsis where it was cut, never splitting a surrogate pair. */
export function shorten(text: string, limit: number, keepTail: boolean): string {
	const kept = limit - ELLIPSIS.length;
	if (keepTail) {
		const tail = text.slice(text.length - kept);
		return ELLIPSIS + (isLowSurrogate(tail.charCodeAt(0)) ? tail.slice(1) : tail);
	}
	const head = text.slice(0, kept);
	return (isHighSurrogate(head.charCodeAt(head.length - 1)) ? head.slice(0, -1) : head) + ELLIPSIS;
}

/** The editable requests whose edit holds a candidate, each with the candidates that would lock it. */
function editLocks(tree: JsonValue, candidates: readonly Candidate[]): EditLock[] {
	const locks = new Map<object, EditLock>();
	for (const candidate of candidates) {
		const index = interactionRequest(candidate.path);
		const field = candidate.path[index + 1];
		if (index < 0 || (field !== "input" && field !== "plan")) continue;
		const request = at(tree, candidate.path.slice(0, index + 1));
		if (request === undefined || request === null || typeof request !== "object" || Array.isArray(request)) continue;
		const flag = field === "input" ? "inputEditable" : "editable";
		if (request[flag] !== true) continue;
		const lock = locks.get(request) ?? { request, flag, candidates: [] };
		lock.candidates.push(candidate);
		locks.set(request, lock);
	}
	return [...locks.values()];
}

/** Where an interaction's `request` sits in `path`: `…interaction.request…` or `…interactions[i].request…`; -1 for none. */
function interactionRequest(path: JsonPath): number {
	return path.findIndex(
		(segment, index) =>
			segment === "request" && (path[index - 1] === "interaction" || path[index - 2] === "interactions"),
	);
}

/** A path through a form field's `when` list: `…fields[i].when[j]…`. */
function isCondition(path: JsonPath): boolean {
	return path.some((segment, index) => segment === "when" && path[index - 2] === "fields");
}

function at(tree: JsonValue, path: JsonPath): JsonValue | undefined {
	let node: JsonValue | undefined = tree;
	for (const segment of path) {
		if (node === null || typeof node !== "object") return undefined;
		node = Array.isArray(node) ? (typeof segment === "number" ? node[segment] : undefined) : node[String(segment)];
	}
	return node;
}

function jsonBytes(text: string): number {
	return Buffer.byteLength(JSON.stringify(text), "utf8") - 2;
}

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
}
