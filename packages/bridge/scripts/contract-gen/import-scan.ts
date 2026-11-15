/**
 * Every module a TypeScript file loads, type-only imports included, read from its tokens so that
 * comments and strings never count. Bun's own scanner sees value imports only (it erases types
 * first), so the layer check takes the union of both.
 */
export interface ImportSite {
	/** Undefined when the specifier is computed, which no static check can follow. */
	readonly specifier: string | undefined;
	readonly line: number;
	/** `import x from "y" with { type: "text" }`: the file's text, not its code. */
	readonly asText?: boolean;
}

interface Token {
	readonly kind: "word" | "string" | "template" | "punct" | "regex";
	readonly text: string;
	readonly line: number;
	/** A string's value, or a template's when it has no substitutions. */
	readonly literal?: string;
}

const REGEX_AFTER_WORDS = new Set([
	"return",
	"typeof",
	"case",
	"do",
	"else",
	"in",
	"of",
	"new",
	"delete",
	"void",
	"throw",
	"instanceof",
	"yield",
	"await",
]);
const REGEX_AFTER_PUNCT = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
const WORD = /[A-Za-z0-9_$]/;

export function importSites(source: string): ImportSite[] {
	const tokens = tokenize(source);
	const sites: ImportSite[] = [];
	tokens.forEach((token, index) => {
		if (token.kind !== "word") return;
		const next = tokens[index + 1]?.text;
		if (token.text === "require" && next === "(") sites.push(callSite(tokens, index, token));
		if (tokens[index - 1]?.text === ".") return;
		if (token.text === "import" && next === "(") sites.push(callSite(tokens, index, token));
		else if (token.text === "import" && next !== ".") staticSite(tokens, index, sites);
		if (token.text === "export") reexportSite(tokens, index, sites);
	});
	return sites;
}

/** `import(x)` or `require(x)`, a member call such as `import.meta.require(x)` too: literal when its argument is a plain string. */
function callSite(tokens: readonly Token[], index: number, call: Token): ImportSite {
	const argument = tokens[index + 2];
	const after = tokens[index + 3]?.text;
	const literal = argument?.literal !== undefined && (after === ")" || after === ",") ? argument.literal : undefined;
	return { specifier: literal, line: call.line };
}

/** `import "x"`, `import … from "x"`; an `import x = require("x")` is found as a require call. */
function staticSite(tokens: readonly Token[], index: number, sites: ImportSite[]): void {
	for (let at = index + 1; at < tokens.length; at++) {
		const token = tokens[at];
		if (!token || token.text === ";" || token.text === "=" || (at > index + 1 && isStatementStart(token))) return;
		if (token.kind === "string" && (at === index + 1 || tokens[at - 1]?.text === "from")) {
			sites.push({
				specifier: token.literal,
				line: token.line,
				...(isTextAttribute(tokens, at + 1) && { asText: true }),
			});
			return;
		}
	}
}

/** `export * from "x"`, `export { a } from "x"`, `export type { a } from "x"`. */
function reexportSite(tokens: readonly Token[], index: number, sites: ImportSite[]): void {
	let at = index + 1;
	if (tokens[at]?.text === "type") at++;
	const opener = tokens[at]?.text;
	if (opener !== "*" && opener !== "{") return;
	for (; at < tokens.length; at++) {
		const token = tokens[at];
		if (!token || token.text === ";") return;
		if (token.kind === "string" && tokens[at - 1]?.text === "from") {
			sites.push({ specifier: token.literal, line: token.line });
			return;
		}
		if (opener === "{" && token.text === "}" && tokens[at + 1]?.text !== "from") return;
	}
}

/** `with { type: "text" }` from `at`. */
function isTextAttribute(tokens: readonly Token[], at: number): boolean {
	const [keyword, open, key, colon, value, close] = tokens.slice(at, at + 6);
	return (
		keyword?.text === "with" &&
		open?.text === "{" &&
		key?.text === "type" &&
		colon?.text === ":" &&
		value?.literal === "text" &&
		close?.text === "}"
	);
}

function isStatementStart(token: Token): boolean {
	return token.kind === "word" && (token.text === "import" || token.text === "export");
}

function tokenize(source: string): Token[] {
	const tokens: Token[] = [];
	let line = 1;
	let at = 0;
	/** Brace depth of each open template substitution, innermost last. */
	const substitutions: number[] = [];
	let depth = 0;
	const push = (kind: Token["kind"], text: string, literal?: string) =>
		tokens.push({ kind, text, line, ...(literal !== undefined && { literal }) });
	const template = (start: number) => {
		let text = "";
		for (at = start; at < source.length; at++) {
			const char = source[at];
			if (char === "\\") {
				text += source[++at] ?? "";
				continue;
			}
			if (char === "\n") line++;
			if (char === "`") {
				at++;
				return { text, closed: true };
			}
			if (char === "$" && source[at + 1] === "{") {
				at += 2;
				return { text, closed: false };
			}
			text += char;
		}
		return { text, closed: true };
	};
	while (at < source.length) {
		const char = source[at] ?? "";
		if (char === "\n") {
			line++;
			at++;
		} else if (/\s/.test(char)) {
			at++;
		} else if (char === "/" && source[at + 1] === "/") {
			while (at < source.length && source[at] !== "\n") at++;
		} else if (char === "/" && source[at + 1] === "*") {
			const end = source.indexOf("*/", at + 2);
			const stop = end < 0 ? source.length : end + 2;
			line += source.slice(at, stop).split("\n").length - 1;
			at = stop;
		} else if (char === "'" || char === '"') {
			let value = "";
			for (at++; at < source.length && source[at] !== char; at++) {
				if (source[at] === "\\") at++;
				value += source[at] ?? "";
			}
			at++;
			push("string", value, value);
		} else if (char === "`") {
			const part = template(at + 1);
			if (part.closed) push("template", part.text, part.text);
			else {
				push("template", part.text);
				substitutions.push(depth);
			}
		} else if (char === "}" && substitutions.at(-1) === depth) {
			substitutions.pop();
			const part = template(at + 1);
			if (!part.closed) substitutions.push(depth);
		} else if (char === "/" && regexMayStart(tokens.at(-1))) {
			const start = at;
			let inClass = false;
			for (at++; at < source.length && (source[at] !== "/" || inClass) && source[at] !== "\n"; at++) {
				if (source[at] === "\\") at++;
				else if (source[at] === "[") inClass = true;
				else if (source[at] === "]") inClass = false;
			}
			for (at++; WORD.test(source[at] ?? ""); at++);
			push("regex", source.slice(start, at));
		} else if (WORD.test(char)) {
			const start = at;
			while (WORD.test(source[at] ?? "")) at++;
			push("word", source.slice(start, at));
		} else {
			if (char === "{") depth++;
			if (char === "}") depth--;
			push("punct", char);
			at++;
		}
	}
	return tokens;
}

function regexMayStart(previous: Token | undefined): boolean {
	if (!previous) return true;
	if (previous.kind === "word") return REGEX_AFTER_WORDS.has(previous.text);
	return previous.kind === "punct" && REGEX_AFTER_PUNCT.has(previous.text);
}
