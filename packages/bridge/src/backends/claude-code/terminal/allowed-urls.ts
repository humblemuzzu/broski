/**
 * Whether an `allowedHttpHookUrls` pattern lets a hook URL through, as the 2.1.325 binary decides before it sends an
 * HTTP hook: `*` lets every URL through; otherwise the pattern is read as a URL with `*` a wildcard in the scheme, host,
 * port and path. The host is compared without case, the path with it; a host wildcard with no port allows any port; a
 * pattern with no path allows every path. A pattern that is no URL, or whose punycode host label holds a wildcard, is
 * matched against `protocol//host/path?search` one `/`-separated segment at a time.
 */

import { randomBytes } from "node:crypto";

const WILD = `zzwildcard${randomBytes(8).toString("hex")}zz`;
const PUNY = `zzpunycode${randomBytes(8).toString("hex")}zz`;
const SPECIAL_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:", "ws:", "wss:", "ftp:", "file:"]);

/** `*` stands for any run of characters, `/` included; everything else is literal and case matters. */
function glob(pattern: string, text: string): boolean {
	const source = pattern
		.split("*")
		.map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, "\\$&"))
		.join("[\\s\\S]*");
	return new RegExp(`^${source}$`).test(text);
}

/** Segment by segment: the separators line up and each segment matches as a glob, so `*` never crosses a `/`. */
function segmentGlob(pattern: string, text: string): boolean {
	const patterns = pattern.split("/");
	const texts = text.split("/");
	return patterns.length === texts.length && patterns.every((part, at) => glob(part, texts[at] ?? ""));
}

/** A punycode label with a wildcard in it is kept from the URL parser, which would decode it. */
function shielded(pattern: string): string {
	return pattern.replace(/[a-z0-9-]+/gi, (label) =>
		/^xn--/i.test(label) && label.includes(WILD) ? PUNY + label : label,
	);
}

function unshielded(text: string): string {
	return text.replaceAll(PUNY, "");
}

function hasWildPunycode(url: URL): boolean {
	return (
		SPECIAL_SCHEMES.has(url.protocol) &&
		url.hostname.split(".").some((label) => label.startsWith("xn--") && label.includes(WILD))
	);
}

function patternUrl(marked: string): { readonly url: URL; readonly anyPort: boolean } | undefined {
	if (URL.canParse(marked)) return { url: new URL(marked), anyPort: false };
	const portless = marked.replace(new RegExp(`:${WILD}(?=[/?#]|$)`), ":0");
	return portless !== marked && URL.canParse(portless) ? { url: new URL(portless), anyPort: true } : undefined;
}

export function urlAllowedBy(url: string, pattern: string): boolean {
	if (pattern === "*") return true;
	if (!URL.canParse(url)) return false;
	const target = new URL(url);
	const marked = shielded(pattern.replaceAll("*", WILD));
	const parsed = patternUrl(marked);
	if (parsed === undefined || hasWildPunycode(parsed.url)) {
		return segmentGlob(pattern, `${target.protocol}//${target.host}${target.pathname}${target.search}`);
	}
	const { url: wanted } = parsed;
	if (wanted.protocol !== `${WILD}:` && wanted.protocol !== target.protocol) return false;
	const host = unshielded(wanted.hostname).replace(/\.$/, "").toLowerCase().replaceAll(WILD, "*");
	if (!glob(host, target.hostname.replace(/\.$/, "").toLowerCase())) return false;
	const anyPort = parsed.anyPort || (wanted.port === "" && wanted.hostname.includes(WILD));
	if (!anyPort && wanted.port !== target.port) return false;
	if ((wanted.pathname === "/" || wanted.pathname === "") && wanted.search === "" && !marked.endsWith("/")) return true;
	return glob(unshielded(wanted.pathname + wanted.search).replaceAll(WILD, "*"), target.pathname + target.search);
}
