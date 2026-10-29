import { corpusLine } from "./line";

export const SWEEPS = [
	"hosts",
	"labels",
	"short-labels",
	"escapes",
	"negated-classes",
	"properties",
	"pair-starts",
	"digit-hosts",
] as const;
export type SweepName = (typeof SWEEPS)[number];

const URI = { format: "uri" } as const;

/** Every code point but the surrogates, which no string holds alone in JSON. */
function* points(): Generator<number> {
	for (let point = 0; point <= 0x10ffff; point++) if (point < 0xd800 || point > 0xdfff) yield point;
}

/** What Unicode says of a code point, for a sweep to be tallied by. */
function kindOf(point: number): string {
	const text = String.fromCodePoint(point);
	if (/^\p{Cn}$/u.test(text)) return "unassigned";
	if (/^\p{Co}$/u.test(text)) return "private use";
	return "assigned";
}

const BASE = 36;

/** RFC 3492 Punycode of `input`, which holds no basic code points but may. */
export function punycode(input: readonly number[]): string {
	const digit = (value: number): string => String.fromCharCode(value + (value < 26 ? 97 : 22));
	const adapt = (delta: number, count: number, first: boolean): number => {
		let scaled = first ? Math.floor(delta / 700) : delta >> 1;
		scaled += Math.floor(scaled / count);
		let k = 0;
		for (; scaled > 455; k += BASE) scaled = Math.floor(scaled / 35);
		return k + Math.floor((36 * scaled) / (scaled + 38));
	};
	const basic = input.filter((point) => point < 0x80);
	let out = String.fromCharCode(...basic);
	let handled = basic.length;
	if (basic.length > 0) out += "-";
	let n = 128;
	let delta = 0;
	let bias = 72;
	while (handled < input.length) {
		const next = Math.min(...input.filter((point) => point >= n));
		delta += (next - n) * (handled + 1);
		n = next;
		for (const point of input) {
			if (point < n) delta++;
			if (point !== n) continue;
			let q = delta;
			for (let k = BASE; ; k += BASE) {
				const threshold = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
				if (q < threshold) break;
				out += digit(threshold + ((q - threshold) % (BASE - threshold)));
				q = Math.floor((q - threshold) / (BASE - threshold));
			}
			out += digit(q);
			bias = adapt(delta, handled + 1, handled === basic.length);
			delta = 0;
			handled++;
		}
		delta++;
		n++;
	}
	return out;
}

/** Every code point as a host, in the middle of a label and alone. */
function* hosts(): Generator<string> {
	for (const point of points()) {
		const text = String.fromCodePoint(point);
		yield corpusLine("uri", `http://a${text}b/`, URI, kindOf(point));
		yield corpusLine("uri", `http://${text}/`, URI, kindOf(point));
	}
}

/** Every code point as a one-character Punycode label. */
function* labels(): Generator<string> {
	for (const point of points()) yield corpusLine("uri", `http://xn--${punycode([point])}/`, URI, kindOf(point));
}

const LABEL_CHARACTERS = "abcdefghijklmnopqrstuvwxyz0123456789-";

const DIGIT_CHARACTERS = ["0", "1", "4", "9", "x", "X", "."];
const NUMBERS_AROUND_THE_LIMIT = ["4294967295", "4294967296", "429496729", "4294967290", "42949672950", "429496730", "1000000000", "10000000000"];

/** Every host of up to seven digits, `x` and dots, and the numbers around 2^32 as the last label before an `x`. */
function* digitHosts(): Generator<string> {
	const walk = function* (prefix: string, left: number): Generator<string> {
		yield corpusLine("uri", `http://${prefix}/`, URI, "digits");
		if (left === 0) return;
		for (const character of DIGIT_CHARACTERS) yield* walk(prefix + character, left - 1);
	};
	yield* walk("", 7);
	for (const number of NUMBERS_AROUND_THE_LIMIT) {
		for (const host of [`${number}x`, `${number}0x`, `${number}X`, `${number}0X1`, `0x${number}`, `${number}.1`, `1.${number}x`]) {
			yield corpusLine("uri", `http://${host}/`, URI, "digits");
		}
	}
}

/** Every `xn--` label of up to four letters, digits and hyphens. */
function* shortLabels(): Generator<string> {
	const walk = function* (prefix: string, left: number): Generator<string> {
		yield corpusLine("uri", `http://xn--${prefix}/`, URI, "label");
		if (left === 0) return;
		for (const character of LABEL_CHARACTERS) yield* walk(prefix + character, left - 1);
	};
	yield* walk("", 4);
}

/** `\X` and `[\X]` for every code point X, against X itself. */
function* escapes(): Generator<string> {
	for (const point of points()) {
		const text = String.fromCodePoint(point);
		yield corpusLine("pattern", text, { pattern: `\\${text}` }, kindOf(point));
		yield corpusLine("pattern", text, { pattern: `[\\${text}]` }, kindOf(point));
	}
}

/** Every text of up to `length` items of `alphabet`, the empty one first. */
function textsOver(alphabet: readonly string[], length: number): string[] {
	const texts = [""];
	let frontier = [""];
	for (let size = 1; size <= length; size++) {
		frontier = frontier.flatMap((text) => alphabet.map((unit) => text + unit));
		texts.push(...frontier);
	}
	return texts;
}

const CLASS_ATOMS = [
	"[^a]", "[^\\d]", "[^\\x00]", "[^\\0]", "[\\0]", "[^\\p{L}]", "[\\P{L}]", "[^\\W]", "[\\W]", "\\P{L}", "\\W", "\\S",
	"\\D", ".", "[^]", "[\\s\\S]", "[a-z\\0]", "[^a-z]", "\\0", "\\x00", "\\u0000", "(?!\\0)", "[\\u0000-\\u0010]",
	"[^\\u0000-\\u0010]", "[^\\0-\\x1f]", "[^\\u0100]", "[^😀]", "[^a😀]", "[\\0😀]", "\\p{Cc}", "\\P{Cc}", "[^\\p{Cc}]",
	"(?:[^a])", "(?<![^a])", "(?<=[^a])", "[^a\\0]", "[^\\s]", "[^\\S]", "[^\\\\]", "[^\\]]", "[^[]", "[^\\u{1F600}]",
];

/** The ways an atom is placed in a pattern: whole, anchored, repeated, after another character. */
function shapesOf(atom: string): string[] {
	return [`^${atom}$`, atom, `^${atom}`, `${atom}$`, `^${atom}+$`, `^${atom}*$`, `^${atom}{2}`, `^.${atom}`];
}

/** Classes, negated and not, against texts over a few code points with U+0000 among them. */
function* negatedClasses(): Generator<string> {
	const alphabet = ["\u0000", "a", "\u0100", "1", "😀", "\u00ff"];
	const texts = textsOver(alphabet, 3);
	for (const atom of CLASS_ATOMS) {
		for (const pattern of shapesOf(atom)) {
			for (const text of texts) yield corpusLine("pattern", text, { pattern }, "class");
		}
	}
}

const PAIR_ATOMS = [
	"\\B", "\\b", "(?<!a)", "(?<!A)", "(?<![^a])", "(?<=a)", "(?<=\\ud83d)", "(?=\\ude00)", "(?!\\ude00)", "(?=)", "$", "^",
	"\\B.", "(?<!a).", "\\B[^]", "(?<!a)\\B", "\\B\\B", ".\\B", ".(?<!a)", "[^a]\\B", "\\B|b", "(?<!a)|b", "x*\\B",
	"(?:\\B)+", "(?:(?<!a))*", "\\B(?=b)", "(?<!a)(?=b)",
];

/** Zero-width assertions, which Dart may match between the halves of a surrogate pair, against pairs and lone halves. */
function* pairStarts(): Generator<string> {
	const texts = textsOver(["a", "😀", "A", "\ud83d", "\ude00", "b"], 4);
	for (const atom of PAIR_ATOMS) {
		for (const pattern of [atom, `^${atom}$`, `${atom}.`]) {
			for (const text of texts) yield corpusLine("pattern", text, { pattern }, "pair");
		}
	}
}

const ASCII_PROPERTIES = [
	"L", "Lu", "Ll", "N", "Nd", "P", "S", "M", "Z", "C", "Cc", "Cn", "Co", "Script=Latin", "Script=Greek", "Emoji",
	"Alphabetic", "ID_Start", "White_Space", "Any", "ASCII", "Uppercase", "Lowercase",
];

/** Property escapes against every ASCII character, and `\p{L}` and `\P{L}` against every code point. */
function* properties(): Generator<string> {
	for (const property of ASCII_PROPERTIES) {
		for (const negation of ["p", "P"]) {
			for (let point = 0; point < 0x80; point++) {
				const pattern = `^\\${negation}{${property}}$`;
				yield corpusLine("pattern", String.fromCharCode(point), { pattern }, "ascii");
			}
		}
	}
	for (const point of points()) {
		const text = String.fromCodePoint(point);
		for (const negation of ["p", "P"]) yield corpusLine("pattern", text, { pattern: `^\\${negation}{L}$` }, kindOf(point));
	}
}

export function sweep(name: SweepName): Generator<string> {
	switch (name) {
		case "hosts":
			return hosts();
		case "labels":
			return labels();
		case "short-labels":
			return shortLabels();
		case "escapes":
			return escapes();
		case "negated-classes":
			return negatedClasses();
		case "properties":
			return properties();
		case "pair-starts":
			return pairStarts();
		case "digit-hosts":
			return digitHosts();
	}
}
