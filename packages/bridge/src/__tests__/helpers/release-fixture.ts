/**
 * A Broski GitHub release served from 127.0.0.1 for `install.sh` tests: stand-in binaries that are shell scripts,
 * their `.gz` and `.tar.xz` copies, `SHA256SUMS`, HTTP Range resume, and faults injected per asset.
 */

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Compression = "gz" | "tar.xz";

export type ReleaseOptions = {
	readonly version: string;
	/** Compressed copies published next to the raw files, which every release lists. */
	readonly compressed?: readonly Compression[];
	/** The new `broski --version` fails, as a build for a newer macOS would. */
	readonly brokenBridge?: boolean;
	/** The bridge's `.tar.xz` holds other bytes than the raw binary its checksum names. */
	readonly mispackedBridge?: boolean;
	/** `broski --version` warns about the config on stderr before its version line, as `readConfig` can. */
	readonly configWarning?: boolean;
};

export type Fault = "drop-once" | "corrupt-once" | "missing";

export type Request = { readonly name: string; readonly range: string | null };

const TARGETS = ["darwin-arm64", "darwin-x64"] as const;
/** Hex of a hash chain: compresses about as badly as a real binary, so downloads span many reads. */
const PADDING = (() => {
	const lines: string[] = [];
	let block = "broski";
	for (let i = 0; i < 4096; i++) {
		block = createHash("sha256").update(block).digest("hex");
		lines.push(`# ${block}${block}`);
	}
	return `${lines.join("\n")}\n`;
})();

export function bridgeScript(version: string, broken = false, configWarning = false): string {
	const warning = configWarning ? 'echo "[config] An adapter is left out: unknown" >&2; ' : "";
	const versionLine = broken
		? 'echo "dyld: Symbol not found" >&2; exit 1'
		: `${warning}echo "broski v${version} (compiled binary)"`;
	return `#!/bin/sh
case "$1" in
  --version) ${versionLine} ;;
  *) echo "$*" >> "$HOME/broski-calls" ;;
esac
exit 0
${PADDING}`;
}

export function linkScript(version: string): string {
	return `#!/bin/sh
case "$1" in
  --version) echo "broski-link ${version}" ;;
  status) printf 'machine   0000  Studio Mac\\nbridge    up\\n' ;;
esac
exit 0
${PADDING}`;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function tarXz(name: string, bytes: Uint8Array): Uint8Array {
	const dir = mkdtempSync(join(tmpdir(), "broski-release-"));
	try {
		writeFileSync(join(dir, name), bytes);
		const out = Bun.spawnSync(["tar", "--no-mac-metadata", "-cJf", `${name}.tar.xz`, name], { cwd: dir });
		if (out.exitCode !== 0) throw new Error(`tar failed: ${out.stderr.toString()}`);
		return readFileSync(join(dir, `${name}.tar.xz`));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

export function buildRelease(options: ReleaseOptions): Map<string, Uint8Array> {
	const formats = options.compressed ?? ["gz", "tar.xz"];
	const files = new Map<string, Uint8Array>();
	const add = (name: string, bytes: Uint8Array<ArrayBuffer>, packed: Uint8Array = bytes) => {
		files.set(name, bytes);
		if (formats.includes("gz")) files.set(`${name}.gz`, Bun.gzipSync(bytes));
		if (formats.includes("tar.xz")) files.set(`${name}.tar.xz`, tarXz(name, packed));
	};
	const encode = (text: string) => new TextEncoder().encode(text);
	for (const target of TARGETS) {
		const bridge = encode(bridgeScript(options.version, options.brokenBridge, options.configWarning));
		const packed = options.mispackedBridge ? encode(bridgeScript("6.6.6")) : bridge;
		add(`broski-${target}`, bridge, packed);
		add(`broski-link-${target}`, encode(linkScript(options.version)));
	}
	files.set("libbroski_pty.dylib", encode(`pty ${options.version}`));
	const sums = [...files.entries()].map(([name, bytes]) => `${sha256(bytes)}  ${name}\n`).join("");
	files.set("SHA256SUMS", encode(sums));
	return files;
}

/**
 * Serves one release at `${url}/<asset>`; `setRelease` and `faults` change it between runs. Uses node:http,
 * whose socket can be cut mid-body: a Bun `Response` stream that stops early ends the body cleanly instead.
 */
export async function serveRelease(initial: Map<string, Uint8Array>) {
	const requests: Request[] = [];
	const faults = new Map<string, Fault>();
	let release = initial;
	const server = createServer((req, res) => {
		const name = decodeURIComponent((req.url ?? "/").slice(1));
		const range = req.headers.range ?? null;
		requests.push({ name, range });
		const bytes = release.get(name);
		const fault = faults.get(name);
		if (!bytes || fault === "missing") {
			res.writeHead(404).end("Not Found");
			return;
		}
		const start = Number(/^bytes=(\d+)-$/.exec(range ?? "")?.[1] ?? 0);
		if (start > 0 && start >= bytes.length) {
			res.writeHead(416, { "content-range": `bytes */${bytes.length}` }).end();
			return;
		}
		const body = bytes.subarray(start);
		const headers: Record<string, string> = { "content-length": String(body.length), "accept-ranges": "bytes" };
		if (start > 0) headers["content-range"] = `bytes ${start}-${bytes.length - 1}/${bytes.length}`;
		res.writeHead(start > 0 ? 206 : 200, headers);
		if (fault === "drop-once") {
			faults.delete(name);
			res.write(body.subarray(0, Math.floor(body.length / 2)), () => setTimeout(() => res.destroy(), 50));
			return;
		}
		if (fault === "corrupt-once") {
			faults.delete(name);
			const flipped = Uint8Array.from(body);
			flipped[flipped.length - 1] = (flipped[flipped.length - 1] ?? 0) ^ 0xff;
			res.end(flipped);
			return;
		}
		res.end(body);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		requests,
		faults,
		setRelease(next: Map<string, Uint8Array>) {
			release = next;
		},
		stop: () => new Promise<void>((done) => server.close(() => done())),
	};
}
