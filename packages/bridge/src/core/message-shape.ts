import { type JsonValue, MAX_CLIENT_MESSAGE_VALUES, MAX_JSON_DEPTH, MAX_LIST_ITEMS } from "../contract";

/**
 * How deep a legal client message nests: free JSON (`MAX_JSON_DEPTH` levels) sits three levels
 * down, at `interaction.answer`'s `answer.reply.editedInput`. A container this deep is refused.
 */
export const MAX_MESSAGE_DEPTH = MAX_JSON_DEPTH + 3;

/**
 * Why `message` cannot be a legal client message by its shape alone, or undefined. One walk that
 * stops at the first excess: more values than `MAX_CLIENT_MESSAGE_VALUES`, a list or object of more
 * than `MAX_LIST_ITEMS` entries (no list or map in `ClientMessage` holds more), or a container
 * `MAX_MESSAGE_DEPTH` deep. It runs before the schema, whose cost grows with every value it checks
 * and every issue it reports, so a refused message costs a bounded walk.
 */
export function shapeProblem(message: JsonValue): string | undefined {
	let values = 0;
	const visit = (value: JsonValue, depth: number): string | undefined => {
		values += 1;
		if (values > MAX_CLIENT_MESSAGE_VALUES) return `the message holds more than ${MAX_CLIENT_MESSAGE_VALUES} values`;
		if (value === null || typeof value !== "object") return undefined;
		if (depth >= MAX_MESSAGE_DEPTH) return `the message nests deeper than ${MAX_MESSAGE_DEPTH} levels`;
		if (Array.isArray(value) && value.length > MAX_LIST_ITEMS) {
			return `a list holds ${value.length} entries; at most ${MAX_LIST_ITEMS}`;
		}
		if (!Array.isArray(value) && hasMoreKeys(value, MAX_LIST_ITEMS)) {
			return `an object holds more than ${MAX_LIST_ITEMS} keys`;
		}
		for (const item of Array.isArray(value) ? value : Object.values(value)) {
			const problem = visit(item, depth + 1);
			if (problem !== undefined) return problem;
		}
		return undefined;
	};
	return visit(message, 0);
}

/** Counts without listing the keys, which for a hostile object would be millions of entries. */
function hasMoreKeys(object: { [key: string]: JsonValue }, limit: number): boolean {
	let keys = 0;
	for (const _key in object) {
		keys += 1;
		if (keys > limit) return true;
	}
	return false;
}
