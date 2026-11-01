/**
 * Whether an `allowedHttpHookUrls` pattern lets a hook URL through, as the 2.1.316 binary's `Yne(url, pattern)` decides:
 * `*` lets every URL through; otherwise the pattern is read as a URL with `*` a wildcard in the scheme, host, port and
 * path; a host wildcard with no port allows any port; a pattern with no path allows every path. A pattern that is no
 * URL is matched as a glob against `protocol//host/path?search`.
 */

const WILD = "wildcardmark";

function glob(pattern: string, text: string): boolean {
	const source = pattern
		.split("*")
		.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
		.join(".*");
	return new RegExp(`^${source}$`, "i").test(text);
}

function patternUrl(pattern: string): { readonly url: URL; readonly anyPort: boolean } | undefined {
	const marked = pattern.replaceAll("*", WILD);
	if (URL.canParse(marked)) return { url: new URL(marked), anyPort: false };
	const portless = marked.replace(new RegExp(`:${WILD}(?=[/?#]|$)`), ":0");
	return portless !== marked && URL.canParse(portless) ? { url: new URL(portless), anyPort: true } : undefined;
}

export function urlAllowedBy(url: string, pattern: string): boolean {
	if (pattern === "*") return true;
	if (!URL.canParse(url)) return false;
	const target = new URL(url);
	const parsed = patternUrl(pattern);
	if (parsed === undefined)
		return glob(pattern, `${target.protocol}//${target.host}${target.pathname}${target.search}`);
	const { url: wanted } = parsed;
	if (wanted.protocol !== `${WILD}:` && wanted.protocol !== target.protocol) return false;
	const host = wanted.hostname.replace(/\.$/, "").replaceAll(WILD, "*");
	if (!glob(host, target.hostname.replace(/\.$/, ""))) return false;
	const anyPort = parsed.anyPort || (wanted.port === "" && wanted.hostname.includes(WILD));
	if (!anyPort && wanted.port !== target.port) return false;
	if ((wanted.pathname === "/" || wanted.pathname === "") && wanted.search === "" && !pattern.endsWith("/"))
		return true;
	return glob((wanted.pathname + wanted.search).replaceAll(WILD, "*"), target.pathname + target.search);
}
