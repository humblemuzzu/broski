/**
 * Whether `JSON.stringify(JSON.parse(text))` keeps every value of a strict JSON text. Two things do not survive it: a
 * key written twice in one object (the parse keeps the last), and a number a double cannot hold (`1e400` becomes
 * `null`, `12345678901234567890` loses digits). A settings edit refuses such a file instead of rewriting it.
 */

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

interface Frame {
	/** The keys seen so far; undefined in an array. */
	readonly keys: Set<string> | undefined;
	expectingKey: boolean;
}

/** Undefined when nothing would change; else what would. `text` must already parse. */
export function roundTripProblem(text: string): string | undefined {
	const frames: Frame[] = [];
	for (let at = 0; at < text.length; at += 1) {
		const char = text.charAt(at);
		const top = frames.at(-1);
		if (char === "{" || char === "[") frames.push({ keys: char === "{" ? new Set() : undefined, expectingKey: true });
		else if (char === "}" || char === "]") frames.pop();
		else if (char === "," && top) top.expectingKey = true;
		else if (char === ":" && top) top.expectingKey = false;
		else if (char === '"') {
			const end = stringEnd(text, at);
			const problem = top?.keys && top.expectingKey ? keyProblem(top.keys, text.slice(at, end + 1)) : undefined;
			if (problem !== undefined) return problem;
			at = end;
		} else if (char === "-" || (char >= "0" && char <= "9")) {
			NUMBER.lastIndex = at;
			const literal = NUMBER.exec(text)?.[0] ?? char;
			if (!sameNumber(literal)) return `the number ${literal} cannot be written back exactly`;
			at += literal.length - 1;
		}
	}
	return undefined;
}

function keyProblem(keys: Set<string>, quoted: string): string | undefined {
	const key: string = JSON.parse(quoted);
	if (keys.has(key)) return `the key ${quoted} is written twice in one object`;
	keys.add(key);
	return undefined;
}

function stringEnd(text: string, start: number): number {
	for (let at = start + 1; at < text.length; at += 1) {
		if (text[at] === "\\") at += 1;
		else if (text[at] === '"') return at;
	}
	return text.length - 1;
}

/** Whether the double nearest `literal` is written back as the same decimal value. */
function sameNumber(literal: string): boolean {
	const value = Number(literal);
	return Number.isFinite(value) && decimal(literal) === decimal(String(value));
}

/** A decimal as `sign digits e exponent` with no leading or trailing zeros; every zero is `0`. */
function decimal(literal: string): string {
	const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(literal);
	if (match === null) return literal;
	const [, sign = "", whole = "", fraction = "", exponent = "0"] = match;
	const digits = `${whole}${fraction}`.replace(/^0+/, "");
	if (digits === "") return "0";
	const trimmed = digits.replace(/0+$/, "");
	const scale = Number(exponent) - fraction.length + (digits.length - trimmed.length);
	return `${sign}${trimmed}e${scale}`;
}
