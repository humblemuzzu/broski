/**
 * Version check and self-update for Broski bridge + broski-link daemon via GitHub Releases.
 *
 * Uses the web redirect at `https://github.com/<repo>/releases/latest` (no GitHub API rate
 * limits, matching Pi's update check), with opt-out via `updates.check: false` in
 * `~/.broski/config.json` or `BROSKI_NO_UPDATE_CHECK=1` / `BROSKI_OFFLINE=1`.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { CURRENT_PLATFORM, getDaemonStatus, isCompiledBinary, restartDaemon } from "./platform";

const DEFAULT_REPO = "humblemuzzu/broski";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const BROSKI_DIR = resolve(homedir(), ".broski");
const LAST_CHECK_FILE = resolve(BROSKI_DIR, "last-update-check.json");

export type UpdateCheckOptions = {
	readonly enabled?: boolean;
	readonly repo?: string;
	readonly baseUrl?: string;
	readonly fetchImpl?: typeof fetch;
};

export type UpdateCheckResult = {
	readonly updateAvailable: boolean;
	readonly currentVersion: string;
	readonly latestVersion: string;
	readonly releaseUrl: string;
};

export function isUpdateCheckDisabled(enabled = true): boolean {
	if (!enabled) return true;
	const noCheck = process.env.BROSKI_NO_UPDATE_CHECK;
	const offline = process.env.BROSKI_OFFLINE;
	return noCheck === "1" || noCheck === "true" || offline === "1" || offline === "true";
}

export function compareSemver(a: string, b: string): number {
	const pa = a.replace(/^v/, "").split("-")[0]?.split(".").map(Number) ?? [];
	const pb = b.replace(/^v/, "").split("-")[0]?.split(".").map(Number) ?? [];
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const va = pa[i] ?? 0;
		const vb = pb[i] ?? 0;
		if (va < vb) return -1;
		if (va > vb) return 1;
	}
	return 0;
}

export function parseSha256Sums(text: string): ReadonlyMap<string, string> {
	const map = new Map<string, string>();
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line);
		if (match?.[1] && match[2]) {
			map.set(match[2].trim(), match[1].toLowerCase());
		}
	}
	return map;
}

function repoOf(options?: UpdateCheckOptions): string {
	return options?.repo ?? process.env.BROSKI_REPO ?? DEFAULT_REPO;
}

function originOf(options?: UpdateCheckOptions): string {
	return (options?.baseUrl ?? process.env.BROSKI_UPDATE_BASE_URL ?? "https://github.com").replace(/\/+$/, "");
}

function getPlatformKey(): string {
	return `${CURRENT_PLATFORM}-${process.arch}`;
}

/**
 * Resolves the latest release tag via `GET /<repo>/releases/latest` with `redirect: "manual"`.
 * Avoids GitHub's 60 req/hr anonymous API quota.
 */
export async function fetchLatestVersion(
	options?: UpdateCheckOptions,
): Promise<{ version: string; tag: string } | null> {
	const repo = repoOf(options);
	const origin = originOf(options);
	const doFetch = options?.fetchImpl ?? fetch;
	const url = `${origin}/${repo}/releases/latest`;
	try {
		const res = await doFetch(url, {
			method: "GET",
			redirect: "manual",
			signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
			headers: { "User-Agent": "broski-bridge" },
		});
		try {
			await res.body?.cancel();
		} catch {
			// Best-effort body discard so the connection can be reused.
		}
		const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
		if (!location?.includes("/releases/tag/")) return null;
		const tag = new URL(location, origin).pathname.split("/").pop();
		if (!tag) return null;
		const decoded = decodeURIComponent(tag);
		const version = decoded.replace(/^v/, "");
		if (!/^\d+\.\d+\.\d+/.test(version)) return null;
		return { version, tag: decoded };
	} catch {
		return null;
	}
}

export async function checkForUpdate(
	currentVersion: string,
	options?: UpdateCheckOptions,
): Promise<UpdateCheckResult | null> {
	if (isUpdateCheckDisabled(options?.enabled)) return null;
	const latest = await fetchLatestVersion(options);
	if (!latest) return null;

	const updateAvailable = compareSemver(currentVersion, latest.version) < 0;
	const repo = repoOf(options);
	const releaseUrl = `${originOf(options)}/${repo}/releases/tag/${latest.tag}`;

	try {
		await mkdir(BROSKI_DIR, { recursive: true });
		await writeFile(
			LAST_CHECK_FILE,
			JSON.stringify({
				checkedAt: new Date().toISOString(),
				currentVersion,
				latestVersion: latest.version,
				updateAvailable,
			}),
		);
	} catch {
		// Non-critical cache write.
	}

	return { updateAvailable, currentVersion, latestVersion: latest.version, releaseUrl };
}

export async function getLastUpdateCheck(): Promise<{
	checkedAt: string;
	latestVersion: string;
	updateAvailable: boolean;
} | null> {
	try {
		const raw = await readFile(LAST_CHECK_FILE, "utf-8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export async function startupUpdateCheck(
	currentVersion: string,
	logger: (msg: string) => void,
	options?: UpdateCheckOptions,
): Promise<UpdateCheckResult | null> {
	if (isUpdateCheckDisabled(options?.enabled)) return null;
	try {
		const result = await checkForUpdate(currentVersion, options);
		if (!result?.updateAvailable) return result;
		logger("");
		logger(`  Update available: v${result.latestVersion} (current: v${result.currentVersion})`);
		logger(`  Release: ${result.releaseUrl}`);
		logger("  Run `broski update` to install, or disable checks with `updates.check: false` in ~/.broski/config.json.");
		logger("");
		return result;
	} catch {
		return null;
	}
}

let periodicTimer: ReturnType<typeof setInterval> | null = null;

export function startPeriodicUpdateCheck(
	currentVersion: string,
	onUpdateAvailable: (result: UpdateCheckResult) => void,
	logger: (msg: string) => void,
	options?: UpdateCheckOptions,
): void {
	if (periodicTimer || isUpdateCheckDisabled(options?.enabled)) return;
	periodicTimer = setInterval(async () => {
		try {
			const result = await checkForUpdate(currentVersion, options);
			if (result?.updateAvailable) {
				logger(`[update] New version available: v${result.latestVersion} (${result.releaseUrl})`);
				onUpdateAvailable(result);
			}
		} catch {
			// Best-effort background check.
		}
	}, CHECK_INTERVAL_MS);

	if (periodicTimer && typeof periodicTimer === "object" && "unref" in periodicTimer) {
		(periodicTimer as { unref: () => void }).unref();
	}
}

export function stopPeriodicUpdateCheck(): void {
	if (periodicTimer) {
		clearInterval(periodicTimer);
		periodicTimer = null;
	}
}

async function downloadVerified(
	url: string,
	expectedSha256: string,
	label: string,
	logger: (msg: string) => void,
): Promise<Buffer> {
	logger(`  Downloading ${label}...`);
	const res = await fetch(url, {
		signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
		headers: { "User-Agent": "broski-bridge" },
	});
	if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} fetching ${label}`);

	const chunks: Uint8Array[] = [];
	const reader = res.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	const bytes = Buffer.concat(chunks);
	const actual = createHash("sha256").update(bytes).digest("hex");
	if (actual !== expectedSha256) {
		throw new Error(`Checksum mismatch for ${label}: expected ${expectedSha256}, got ${actual}`);
	}
	logger(`  Verified ${label} (${Math.max(1, Math.round(bytes.length / 1024 / 1024))} MB).`);
	return bytes;
}

async function atomicInstall(targetPath: string, bytes: Buffer): Promise<void> {
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
		if (hadTarget) {
			await unlink(backupPath).catch(() => undefined);
		}
	} catch (err) {
		await unlink(tmpPath).catch(() => undefined);
		throw err;
	}
}

export async function performUpdate(
	currentVersion: string,
	logger: (msg: string) => void,
	options?: UpdateCheckOptions,
): Promise<boolean> {
	logger("Checking GitHub Releases for updates...");
	const latest = await fetchLatestVersion(options);
	if (!latest) {
		logger("  Could not reach GitHub Releases. Check your internet connection.");
		return false;
	}

	if (compareSemver(currentVersion, latest.version) >= 0) {
		logger(`  Already on the latest version (v${currentVersion}).`);
		return false;
	}

	const repo = repoOf(options);
	const origin = originOf(options);
	const downloadBase = `${origin}/${repo}/releases/download/${latest.tag}`;
	logger(`  New version available: v${latest.version} (current: v${currentVersion})`);

	if (!isCompiledBinary()) {
		logger("  Self-update is only available for compiled binaries.");
		logger(`  Pull the latest code or download v${latest.version} from ${origin}/${repo}/releases/tag/${latest.tag}`);
		return false;
	}

	const platform = getPlatformKey();
	const bridgeAsset = `broski-${platform}`;
	const linkAsset = `broski-link-${platform}`;
	const ptyAsset = "libbroski_pty.dylib";

	try {
		const sumsRes = await fetch(`${downloadBase}/SHA256SUMS`, {
			signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
			headers: { "User-Agent": "broski-bridge" },
		});
		if (!sumsRes.ok) {
			logger(`  Could not fetch SHA256SUMS (HTTP ${sumsRes.status}). Aborting update.`);
			return false;
		}
		const sums = parseSha256Sums(await sumsRes.text());
		const bridgeSha = sums.get(bridgeAsset);
		if (!bridgeSha) {
			logger(`  No binary for ${platform} in v${latest.version} SHA256SUMS.`);
			return false;
		}

		const binaryDir = dirname(process.execPath);
		const bridgeBytes = await downloadVerified(`${downloadBase}/${bridgeAsset}`, bridgeSha, bridgeAsset, logger);
		await atomicInstall(process.execPath, bridgeBytes);

		const linkSha = sums.get(linkAsset);
		if (linkSha) {
			const linkBytes = await downloadVerified(`${downloadBase}/${linkAsset}`, linkSha, linkAsset, logger);
			await atomicInstall(resolve(binaryDir, "broski-link"), linkBytes);
		}

		const ptySha = CURRENT_PLATFORM === "darwin" ? sums.get(ptyAsset) : undefined;
		if (ptySha) {
			const ptyBytes = await downloadVerified(`${downloadBase}/${ptyAsset}`, ptySha, ptyAsset, logger);
			await atomicInstall(resolve(binaryDir, ptyAsset), ptyBytes);
		}

		logger(`  Updated to v${latest.version}!`);

		const status = await getDaemonStatus();
		if (status.installed && status.running) {
			logger("  Restarting daemon...");
			try {
				await restartDaemon();
				logger("  Daemon restarted with new version.");
			} catch {
				logger("  Could not restart daemon automatically. Run `broski restart` to apply.");
			}
		} else if (status.installed) {
			logger("  Daemon is installed but not running. The new version will run on next start.");
		} else {
			logger("  Restart the bridge to use the new version.");
		}
		return true;
	} catch (err) {
		logger(`  Update failed: ${err instanceof Error ? err.message : String(err)}`);
		return false;
	}
}
