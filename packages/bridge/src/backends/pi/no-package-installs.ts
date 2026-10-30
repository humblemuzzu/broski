/**
 * Loading a cwd's resources (`DefaultResourceLoader.reload`) installs every configured npm or git package that is
 * not on disk, as the terminal `pi` does when it starts: the loader resolves packages with no `onMissing`
 * (pi-coding-agent `src/core/resource-loader.ts:529`, `src/core/package-manager.ts:1308-1313`). A session opened or
 * a command list read from the phone must not run `npm install` or `git clone` into the user's agent directory
 * under a request's deadline, so missing packages are skipped and named instead; running `pi` in a terminal installs them.
 */

import { DefaultPackageManager, type SettingsManager } from "@earendil-works/pi-coding-agent";

export interface PackageTarget {
	readonly cwd: string;
	readonly agentDir: string;
	readonly settingsManager: SettingsManager;
}

let holders = 0;
let before: string | undefined;

/**
 * Runs `work` (a load for `target`) so that it installs nothing, and says which configured packages it left out.
 * Pi's own resolution runs first with an `onMissing` that installs nothing (`"skip"`); when nothing is missing the
 * load cannot install either, and runs untouched. Otherwise `PI_OFFLINE`, the only switch 1.4.0 gives a load, is on
 * while it runs. Pi reads that variable at each call (`package-manager.ts:60-64`, `src/utils/tools-manager.ts:15-19`),
 * so it holds for the whole process meanwhile, and a `find` or `grep` elsewhere cannot download a missing `fd` or
 * `rg` (`tools-manager.ts:362-365`) until the last such load ends and the process's own value is back.
 */
export async function withoutPackageInstalls<T>(
	target: PackageTarget,
	work: () => Promise<T>,
): Promise<{ readonly value: T; readonly missing: readonly string[] }> {
	const missing = await missingPackages(target);
	if (missing.length === 0) return { value: await work(), missing };
	if (holders++ === 0) {
		before = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "1";
	}
	try {
		return { value: await work(), missing };
	} finally {
		if (--holders === 0) {
			if (before === undefined) delete process.env.PI_OFFLINE;
			else process.env.PI_OFFLINE = before;
		}
	}
}

/** The configured package sources the load would install, by Pi's own resolution of `target`'s settings. */
async function missingPackages(target: PackageTarget): Promise<string[]> {
	const missing: string[] = [];
	await new DefaultPackageManager(target).resolve(async (source) => {
		missing.push(source);
		return "skip";
	});
	return missing;
}
