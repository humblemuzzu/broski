import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { chmod, rename, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

const STALL_TIMEOUT_MS = 60_000;
const MAX_DOWNLOAD_MS = 30 * 60_000;
const PROGRESS_INTERVAL_MS = 3_000;
const DOWNLOAD_ATTEMPTS = 5;
const RETRY_BASE_MS = 1_000;

export type DownloadOptions = {
	readonly stallTimeoutMs?: number;
	readonly maxDownloadMs?: number;
	readonly attempts?: number;
	readonly retryBaseMs?: number;
	readonly fetchImpl?: typeof fetch;
};

export type PickedAsset = {
	readonly asset: string;
	readonly sha256: string;
	readonly gzipped: boolean;
};

class NonRetryableDownloadError extends Error {}

export function pickReleaseAsset(sums: ReadonlyMap<string, string>, name: string): PickedAsset | undefined {
	const gzName = `${name}.gz`;
	const gzSha = sums.get(gzName);
	if (gzSha) return { asset: gzName, sha256: gzSha, gzipped: true };
	const rawSha = sums.get(name);
	return rawSha ? { asset: name, sha256: rawSha, gzipped: false } : undefined;
}

export async function fileSha256(filePath: string): Promise<string | undefined> {
	if (!existsSync(filePath)) return undefined;
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(filePath)) hash.update(chunk);
	return hash.digest("hex");
}

export async function matchesInstalled(targetPath: string, expectedRawSha: string | undefined): Promise<boolean> {
	if (!expectedRawSha) return false;
	return (await fileSha256(targetPath)) === expectedRawSha;
}

function progressLine(label: string, received: number, transferred: number, total: number, elapsedSec: number): string {
	const mb = (received / 1_048_576).toFixed(1);
	const speed = elapsedSec > 0.2 ? ` · ${(transferred / 1_048_576 / elapsedSec).toFixed(1)} MB/s` : "";
	const suffix =
		total > 0
			? ` / ${(total / 1_048_576).toFixed(1)} MB (${Math.round((received * 100) / total)}%)${speed}`
			: ` MB${speed}`;
	return `  Downloading ${label}... ${mb}${suffix}`;
}

function parseTotalSize(res: Response, offset: number): number {
	const range = res.headers.get("content-range");
	const rangeTotal = range ? Number(/\/(\d+)$/.exec(range)?.[1] ?? 0) : 0;
	if (rangeTotal > 0) return rangeTotal;
	const length = Number(res.headers.get("content-length") ?? 0);
	return length > 0 ? offset + length : 0;
}

async function writeChunk(out: ReturnType<typeof createWriteStream>, chunk: Uint8Array): Promise<void> {
	if (out.write(chunk)) return;
	await new Promise<void>((res, rej) => {
		out.once("drain", res);
		out.once("error", rej);
	});
}

async function closeStream(out: ReturnType<typeof createWriteStream>): Promise<void> {
	await new Promise<void>((res, rej) => {
		out.once("error", rej);
		out.end(res);
	});
}

async function streamToDisk(
	res: Response,
	partPath: string,
	offset: number,
	label: string,
	logger: (msg: string) => void,
	onChunk: () => void,
): Promise<void> {
	if (!res.body) throw new Error(`Empty response body fetching ${label}`);
	const total = parseTotalSize(res, offset);
	const out = createWriteStream(partPath, { flags: offset > 0 ? "a" : "w" });
	const reader = res.body.getReader();
	let received = offset;
	let lastLog = Date.now();
	const startedAt = lastLog;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			onChunk();
			await writeChunk(out, value);
			received += value.byteLength;
			const now = Date.now();
			if (now - lastLog >= PROGRESS_INTERVAL_MS) {
				lastLog = now;
				logger(progressLine(label, received, received - offset, total, (now - startedAt) / 1000));
			}
		}
		await closeStream(out);
	} catch (err) {
		await closeStream(out).catch(() => out.destroy());
		throw err;
	}
}

async function currentPartSize(partPath: string): Promise<number> {
	try {
		return (await stat(partPath)).size;
	} catch {
		return 0;
	}
}

async function fetchRangeAttempt(
	url: string,
	partPath: string,
	label: string,
	logger: (msg: string) => void,
	options?: DownloadOptions,
): Promise<"done" | "range_unsatisfiable"> {
	const stallMs = options?.stallTimeoutMs ?? STALL_TIMEOUT_MS;
	const maxMs = options?.maxDownloadMs ?? MAX_DOWNLOAD_MS;
	const fetchFn = options?.fetchImpl ?? fetch;
	const offset = await currentPartSize(partPath);
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
	const headers: Record<string, string> = { "User-Agent": "broski-bridge" };
	if (offset > 0) {
		headers.Range = `bytes=${offset}-`;
		logger(`  Resuming ${label} from ${(offset / 1_048_576).toFixed(1)} MB...`);
	} else {
		logger(`  Downloading ${label}...`);
	}
	try {
		const res = await fetchFn(url, { signal: controller.signal, headers });
		if (res.status === 416 && offset > 0) return "range_unsatisfiable";
		if (res.status === 401 || res.status === 403 || res.status === 404) {
			throw new NonRetryableDownloadError(`HTTP ${res.status} fetching ${label}`);
		}
		if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${label}`);
		const writeOffset = res.status === 206 ? offset : 0;
		await streamToDisk(res, partPath, writeOffset, label, logger, resetStall);
		return "done";
	} finally {
		if (stallTimer) clearTimeout(stallTimer);
		clearTimeout(maxTimer);
	}
}

export async function downloadFileVerified(
	url: string,
	expectedSha256: string,
	partPath: string,
	label: string,
	logger: (msg: string) => void,
	options?: DownloadOptions,
): Promise<void> {
	const attempts = Math.max(1, options?.attempts ?? DOWNLOAD_ATTEMPTS);
	const retryBaseMs = options?.retryBaseMs ?? RETRY_BASE_MS;
	let lastError: unknown;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			const outcome = await fetchRangeAttempt(url, partPath, label, logger, options);
			const actual = await fileSha256(partPath);
			if (actual === expectedSha256) {
				const sizeMb = Math.max(1, Math.round((await currentPartSize(partPath)) / 1_048_576));
				logger(`  Verified ${label} (${sizeMb} MB).`);
				return;
			}
			await unlink(partPath).catch(() => undefined);
			if (outcome === "range_unsatisfiable") throw new Error(`Server rejected resume range for ${label}`);
			throw new Error(`Checksum mismatch for ${label}: expected ${expectedSha256}, got ${actual ?? "missing"}`);
		} catch (err) {
			lastError = err;
			if (err instanceof NonRetryableDownloadError || attempt >= attempts) break;
			const waitMs = Math.min(retryBaseMs * 2 ** (attempt - 1), 10_000);
			const detail = err instanceof Error ? err.message : String(err);
			logger(`  Download interrupted (${detail}); retrying in ${Math.max(1, Math.round(waitMs / 1000))}s...`);
			await new Promise((res) => setTimeout(res, waitMs));
		}
	}
	await unlink(partPath).catch(() => undefined);
	throw lastError;
}

export async function atomicSwapFile(stagedPath: string, targetPath: string): Promise<void> {
	const dir = dirname(targetPath);
	const backupPath = resolve(dir, `.broski-backup-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
	const hadTarget = existsSync(targetPath);
	try {
		await chmod(stagedPath, 0o755);
		if (hadTarget) await rename(targetPath, backupPath);
		try {
			await rename(stagedPath, targetPath);
		} catch (err) {
			if (hadTarget && existsSync(backupPath)) await rename(backupPath, targetPath);
			throw err;
		}
		if (hadTarget) await unlink(backupPath).catch(() => undefined);
	} catch (err) {
		await unlink(stagedPath).catch(() => undefined);
		throw err;
	}
}

export async function installReleaseAsset(
	downloadBase: string,
	picked: PickedAsset,
	targetPath: string,
	logger: (msg: string) => void,
	options?: DownloadOptions,
): Promise<void> {
	const dir = dirname(targetPath);
	const tag = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
	const partPath = resolve(dir, `.broski-part-${tag}`);
	const stagedPath = picked.gzipped ? resolve(dir, `.broski-new-${tag}`) : partPath;
	try {
		await downloadFileVerified(
			`${downloadBase}/${picked.asset}`,
			picked.sha256,
			partPath,
			picked.asset,
			logger,
			options,
		);
		if (picked.gzipped) {
			await pipeline(createReadStream(partPath), createGunzip(), createWriteStream(stagedPath));
			await unlink(partPath).catch(() => undefined);
		}
		await atomicSwapFile(stagedPath, targetPath);
	} catch (err) {
		await unlink(partPath).catch(() => undefined);
		if (stagedPath !== partPath) await unlink(stagedPath).catch(() => undefined);
		throw err;
	}
}
