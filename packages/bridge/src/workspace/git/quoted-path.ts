const ESCAPES: Readonly<Record<string, number>> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * A C-quoted path as git writes one holding a quote, a backslash or a control character (non-ASCII stays
 * verbatim under `core.quotePath=false`): the path, and the text after its closing quote. Octal escapes are
 * bytes of the path's UTF-8.
 */
export function readQuoted(text: string): [string, string] {
	const bytes: number[] = [];
	let index = 1;
	while (index < text.length && text[index] !== '"') {
		const char = text.codePointAt(index) ?? 0;
		if (char !== 92) {
			const literal = String.fromCodePoint(char);
			bytes.push(...encoder.encode(literal));
			index += literal.length;
			continue;
		}
		const octal = /^[0-7]{3}/.exec(text.slice(index + 1, index + 4));
		if (octal) {
			bytes.push(Number.parseInt(octal[0], 8));
			index += 4;
		} else {
			const escaped = text.charAt(index + 1);
			bytes.push(ESCAPES[escaped] ?? escaped.charCodeAt(0));
			index += 2;
		}
	}
	return [decoder.decode(Uint8Array.from(bytes)), text.slice(index + 1)];
}

/** A path as git printed it, quoted or not. */
export function unquotePath(text: string): string {
	return text.startsWith('"') ? readQuoted(text)[0] : text;
}
