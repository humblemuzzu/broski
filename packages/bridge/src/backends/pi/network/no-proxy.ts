/** Which addresses a proxy is never used for: this machine's own, and what `NO_PROXY` lists. */

/** Always on the list, ahead of the user's: a local model server or a loopback service is never behind the proxy. */
export const LOOPBACK_NO_PROXY = "localhost,127.0.0.1,::1";

function hostnameOf(url: URL): string {
	const host = url.hostname.toLowerCase();
	return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function isThisMachine(host: string): boolean {
	return (
		host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0" || /^127\./.test(host)
	);
}

interface NoProxyEntry {
	readonly host: string;
	/** Zero: any port. */
	readonly port: number;
}

function entryOf(raw: string): NoProxyEntry | undefined {
	const entry = raw.trim().toLowerCase();
	if (entry === "") return undefined;
	const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(entry);
	if (bracketed) return { host: bracketed[1] ?? "", port: Number(bracketed[2] ?? 0) };
	const hostPort = /^([^:]+):(\d+)$/.exec(entry);
	const host = (hostPort?.[1] ?? entry).replace(/^\*?\./, "");
	return { host, port: Number(hostPort?.[2] ?? 0) };
}

/**
 * Whether `url` is reached without the proxy: it names this machine, or matches an entry of the comma- or
 * space-separated `noProxy`. `*` is every address; `example.com` and `.example.com` are that host and its subdomains;
 * `host:port` is that port only.
 */
export function bypassesProxy(url: URL, noProxy: string): boolean {
	const host = hostnameOf(url);
	if (isThisMachine(host)) return true;
	const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
	return noProxy.split(/[\s,]+/).some((raw) => {
		if (raw === "*") return true;
		const entry = entryOf(raw);
		if (entry === undefined || (entry.port !== 0 && entry.port !== port)) return false;
		return host === entry.host || host.endsWith(`.${entry.host}`);
	});
}
