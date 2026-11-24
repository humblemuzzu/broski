import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const INSTALLER_TIMEOUT_MS = 30_000;
const INSTALLER_PATH_IN_REPO = "packages/bridge/scripts/install.sh";

export type InstallerSource = {
	readonly repo: string;
	readonly tag: string;
	readonly downloadBase: string;
	readonly rawOrigin: string;
	readonly fetchImpl?: typeof fetch;
};

/**
 * The installer published with the release, else the one committed at its tag: a release uploaded by hand may
 * lack the asset, and both are that release's own installer.
 */
export function installerUrls(source: InstallerSource): string[] {
	return [
		`${source.downloadBase}/install.sh`,
		`${source.rawOrigin}/${source.repo}/${encodeURIComponent(source.tag)}/${INSTALLER_PATH_IN_REPO}`,
	];
}

export async function fetchInstaller(source: InstallerSource, logger: (msg: string) => void): Promise<string | null> {
	const doFetch = source.fetchImpl ?? fetch;
	for (const url of installerUrls(source)) {
		try {
			const res = await doFetch(url, {
				signal: AbortSignal.timeout(INSTALLER_TIMEOUT_MS),
				headers: { "User-Agent": "broski-bridge" },
			});
			const text = res.ok ? await res.text() : "";
			if (text.startsWith("#!/bin/sh")) return text;
			logger(`  No installer at ${url} (HTTP ${res.status}).`);
		} catch (err) {
			logger(`  Could not fetch ${url}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	return null;
}

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * Runs the installer attached to this terminal and returns its exit code. Like a shell with a foreground job, this
 * process outlives Ctrl-C: the installer gets the signal, says how to resume, and exits before the copy is removed.
 */
export async function runInstaller(script: string, env: Record<string, string | undefined>): Promise<number> {
	const dir = await mkdtemp(join(tmpdir(), "broski-update-"));
	const ignore = () => {};
	for (const signal of FORWARDED_SIGNALS) process.on(signal, ignore);
	try {
		const path = join(dir, "install.sh");
		await writeFile(path, script, { mode: 0o700 });
		const child = Bun.spawn(["/bin/sh", path], { stdio: ["inherit", "inherit", "inherit"], env });
		return await child.exited;
	} finally {
		for (const signal of FORWARDED_SIGNALS) process.off(signal, ignore);
		await rm(dir, { recursive: true, force: true });
	}
}
