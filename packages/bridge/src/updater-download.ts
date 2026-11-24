import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const STALL_TIMEOUT_MS = 60_000;
const MAX_DOWNLOAD_MS = 30 * 60_000;
const PROGRESS_INTERVAL_MS = 3_000;
const DOWNLOAD_ATTEMPTS = 2;

export type DownloadOptions = {
	readonly stallTimeoutMs?: number;
	readonly maxDownloadMs?: number;
	readonly attempts?: number;
	readonly fetchImpl?: typeof fetch;
};

export type PickedAsset = {
	readonly asset: string;
	readonly sha256: string;
	readonly gzipped: boolean;
};

export function pickReleaseAsset(sums: ReadonlyMap<string, string>, name: string): PickedAsset | undefined {
	const gzName = `${name}.gz`;
	const gzSha = sums.get(gzName);
	if (gzSha) return { asset: gzName, sha256: gzSha, gzipped: true };
	const rawSha = sums.get(name);
	return rawSha ? { asset: name, sha256: rawSha, gzipped: false } : undefined;
}

export async function downloadVerified(
	url: string,
	expectedSha256: string,
	label: string,
	logger: (msg: string) => void,
	options?: DownloadOptions,
): Promise<Buffer> {
	const attempts = Math.max(1, options?.attempts ?? DOWNLOAD_ATTEMPTS);
	let lastError: unknown;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			return await downloadOnce(url, expectedSha256, label, logger, options);
		} catch (err) {
			lastError = err;
			if (attempt < attempts) {
				logger(`  Download interrupted (${err instanceof Error ? err.message : String(err)}); retrying...`);
			}
		}
	}
	throw lastError;
}

function progressLine(label: string, received: number, total: number): string {
	const mb = (received / 1_048_576).toFixed(1);
	const suffix =
		total > 0 ? ` / ${(total / 1_048_576).toFixed(1)} MB (${Math.round((received * 100) / total)}%)` : " MB";
	return `  Downloading ${label}... ${mb}${suffix}`;
}

async function readStream(
	body: ReadableStream<Uint8Array>,
	total: number,
	label: string,
	logger: (msg: string) => void,
	onChunk: () => void,
): Promise<Buffer> {
	const chunks: Uint8Array[] = [];
	const reader = body.getReader();
	let received = 0;
	let lastLog = Date.now();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		onChunk();
		chunks.push(value);
		received += value.byteLength;
		const now = Date.now();
		if (now - lastLog >= PROGRESS_INTERVAL_MS) {
			lastLog = now;
			logger(progressLine(label, received, total));
		}
	}
	return Buffer.concat(chunks);
}

async function downloadOnce(
	url: string,
	expectedSha256: string,
	label: string,
	logger: (msg: string) => void,
	options?: DownloadOptions,
): Promise<Buffer> {
	const stallMs = options?.stallTimeoutMs ?? STALL_TIMEOUT_MS;
	const maxMs = options?.maxDownloadMs ?? MAX_DOWNLOAD_MS;
	const fetchFn = options?.fetchImpl ?? fetch;
	const controller = new AbortController();
	let stallTimer: ReturnType<typeof setTimeout> | undefined;
	const resetStall = () => {
		if (stallTimer) clearTimeout(stallTimer);
		stallTimer = setTimeout(
			() => controller.abort(new Error(`download stalled for ${Math.round(stallMs / 1000)}s`)),
			stallMs,
		);
	};
	const maxTimer = setTimeout(() => controller.abort(new Error("download exceeded maximum time")), maxMs);
	resetStall();
	logger(`  Downloading ${label}...`);
	try {
		const res = await fetchFn(url, { signal: controller.signal, headers: { "User-Agent": "broski-bridge" } });
		if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} fetching ${label}`);
		const total = Number(res.headers.get("content-length") ?? 0);
		const bytes = await readStream(res.body, total, label, logger, resetStall);
		const actual = createHash("sha256").update(bytes).digest("hex");
		if (actual !== expectedSha256) {
			throw new Error(`Checksum mismatch for ${label}: expected ${expectedSha256}, got ${actual}`);
		}
		logger(`  Verified ${label} (${Math.max(1, Math.round(bytes.length / 1_048_576))} MB).`);
		return bytes;
	} finally {
		if (stallTimer) clearTimeout(stallTimer);
		clearTimeout(maxTimer);
	}
}

export async function fetchAndExtract(
	downloadBase: string,
	picked: PickedAsset,
	logger: (msg: string) => void,
): Promise<Buffer> {
	const bytes = await downloadVerified(`${downloadBase}/${picked.asset}`, picked.sha256, picked.asset, logger);
	return picked.gzipped ? gunzipSync(bytes) : bytes;
}

export async function atomicInstall(targetPath: string, bytes: Buffer): Promise<void> {
	const dir = dirname(targetPath);
	const stamp = Date.now();
	const tmpPath = resolve(dir, `.broski-update-${stamp}-${Math.random().toString(16).slice(2, 8)}`);
	const backupPath = resolve(dir, `.broski-backup-${stamp}-${Math.random().toString(16).slice(2, 8)}`);
	const hadTarget = existsSync(targetPath);
	try {
		await writeFile(tmpPath, bytes);
		await chmod(tmpPath, 0o755);
		if (hadTarget) await rename(targetPath, backupPath);
		try {
			await rename(tmpPath, targetPath);
		} catch (err) {
			if (hadTarget && existsSync(backupPath)) await rename(backupPath, targetPath);
			throw err;
		}
		if (hadTarget) await unlink(backupPath).catch(() => undefined);
	} catch (err) {
		await unlink(tmpPath).catch(() => undefined);
		throw err;
	}
}
