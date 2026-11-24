/**
 * Version check and self-update for Broski bridge + broski-link daemon via GitHub Releases.
 *
 * Uses the web redirect at `https://github.com/<repo>/releases/latest` (no GitHub API rate
 * limits, matching Pi's update check), with opt-out via `updates.check: false` in
 * `~/.broski/config.json` or `BROSKI_NO_UPDATE_CHECK=1` / `BROSKI_OFFLINE=1`.
 */

import { realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { isCompiledBinary } from "./platform";
import { fetchInstaller, runInstaller } from "./updater-installer";

const DEFAULT_REPO = "humblemuzzu/broski";
const RAW_ORIGIN = "https://raw.githubusercontent.com";
const INSTALLED_BINARY = resolve(homedir(), ".broski", "bin", "broski");
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 10_000;
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

function repoOf(options?: UpdateCheckOptions): string {
	if (options?.repo) return options.repo;
	return isCompiledBinary() ? DEFAULT_REPO : (process.env.BROSKI_REPO ?? DEFAULT_REPO);
}

function originOf(options?: UpdateCheckOptions): string {
	if (options?.baseUrl) return options.baseUrl.replace(/\/+$/, "");
	const base = isCompiledBinary() ? "https://github.com" : (process.env.BROSKI_UPDATE_BASE_URL ?? "https://github.com");
	return base.replace(/\/+$/, "");
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

export type UpdateOptions = UpdateCheckOptions & {
	readonly rawOrigin?: string;
	readonly compiled?: boolean;
};

/**
 * Installs the latest release by running that release's own `install.sh`, which downloads, verifies, swaps and
 * restarts. Nothing here downloads binaries, so no bug in an installed version can stop the next update.
 */
export async function performUpdate(
	currentVersion: string,
	logger: (msg: string) => void,
	options?: UpdateOptions,
): Promise<boolean> {
	logger("Checking GitHub Releases for updates...");
	const latest = await fetchLatestVersion(options);
	if (!latest) {
		logger("  Could not reach GitHub Releases. Check your internet connection.");
		return false;
	}

	if (compareSemver(currentVersion, latest.version) >= 0) {
		logger(`  Already on the latest version (v${currentVersion}).`);
		return true;
	}

	const repo = repoOf(options);
	const origin = originOf(options);
	const downloadBase = `${origin}/${repo}/releases/download/${latest.tag}`;
	logger(`  New version available: v${latest.version} (current: v${currentVersion})`);

	if (!(options?.compiled ?? isCompiledBinary())) {
		logger("  Self-update is only available for compiled binaries.");
		logger(`  Pull the latest code or download v${latest.version} from ${origin}/${repo}/releases/tag/${latest.tag}`);
		return false;
	}

	const rawOrigin = (options?.rawOrigin ?? RAW_ORIGIN).replace(/\/+$/, "");
	const fetchImpl = options?.fetchImpl;
	const script = await fetchInstaller({ repo, tag: latest.tag, downloadBase, rawOrigin, fetchImpl }, logger);
	if (!script) {
		logger(
			`  Could not download the v${latest.version} installer. Check your connection and run \`broski update\` again.`,
		);
		return false;
	}

	warnIfNotInstalledCopy(logger);
	const env = { ...process.env, BROSKI_REPO: repo, BROSKI_VERSION: latest.tag, BROSKI_BASE_URL: downloadBase };
	const code = await runInstaller(script, env);
	if (code !== 0) logger("  The update did not finish. Run `broski update` again: it resumes where it stopped.");
	return code === 0;
}

function realPathOr(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

function warnIfNotInstalledCopy(logger: (msg: string) => void): void {
	const running = realPathOr(process.execPath);
	if (running !== realPathOr(INSTALLED_BINARY)) {
		logger(`  Note: this broski runs from ${running}; the update installs to ${INSTALLED_BINARY}.`);
	}
}
