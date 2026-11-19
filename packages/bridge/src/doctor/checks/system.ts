import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import packageMeta from "../../../package.json";
import { CURRENT_PLATFORM, isCompiledBinary } from "../../platform";
import type { DoctorContext } from "../context";
import type { CheckResult } from "../types";
import { dirExists } from "../utils";

export async function runSystemChecks(ctx: DoctorContext): Promise<CheckResult[]> {
	const results: CheckResult[] = [];

	const mode = isCompiledBinary() ? "compiled binary" : "dev mode (bun)";
	results.push({
		id: "platform_info",
		category: "system",
		status: "info",
		message: `${CURRENT_PLATFORM} ${process.arch}, ${mode}`,
	});

	const version = packageMeta.version ?? "0.1.0";
	try {
		const { checkForUpdate } = await import("../../updater");
		const update = await checkForUpdate(version);
		if (!update) {
			results.push({
				id: "version_check",
				category: "system",
				status: "info",
				message: `v${version} (update check skipped)`,
			});
		} else if (update.updateAvailable) {
			results.push({
				id: "version_check",
				category: "system",
				status: "warning",
				message: `v${version} installed — v${update.latestVersion} available`,
				fix: "Run `broski update`",
			});
		} else {
			results.push({
				id: "version_check",
				category: "system",
				status: "ok",
				message: `v${version} (up to date)`,
			});
		}
	} catch {
		results.push({
			id: "version_check",
			category: "system",
			status: "info",
			message: `v${version} (update check skipped)`,
		});
	}

	const homeExists = await dirExists(ctx.paths.home);
	if (homeExists) {
		results.push({
			id: "broski_home",
			category: "system",
			status: "ok",
			message: "~/.broski exists",
		});
	} else {
		results.push({
			id: "broski_home",
			category: "system",
			status: "error",
			message: "~/.broski missing",
			fix: "Will be created automatically",
			autoFix: async () => {
				await mkdir(ctx.paths.home, { recursive: true });
				return await dirExists(ctx.paths.home);
			},
		});
	}

	const dirs = [
		{ path: ctx.paths.bin, label: "bin/" },
		{ path: ctx.paths.logs, label: "logs/" },
		{ path: ctx.paths.tls, label: "tls/" },
	];
	for (const dir of dirs) {
		const exists = await dirExists(dir.path);
		if (exists) {
			results.push({
				id: `dir_${dir.label}`,
				category: "system",
				status: "ok",
				message: `~/.broski/${dir.label} exists`,
			});
		} else {
			results.push({
				id: `dir_${dir.label}`,
				category: "system",
				status: "warning",
				message: `~/.broski/${dir.label} missing`,
				fix: `mkdir -p ~/.broski/${dir.label}`,
				autoFix: async () => {
					await mkdir(dir.path, { recursive: true });
					return await dirExists(dir.path);
				},
			});
		}
	}

	const pathEnv = process.env.PATH ?? "";
	const onPath = pathEnv.split(":").some((p) => {
		try {
			return resolve(p) === ctx.paths.bin;
		} catch {
			return false;
		}
	});
	results.push(
		onPath
			? {
					id: "path_check",
					category: "system",
					status: "ok",
					message: "~/.broski/bin is on PATH",
				}
			: {
					id: "path_check",
					category: "system",
					status: "warning",
					message: "~/.broski/bin not on PATH",
					fix: 'Add export PATH="$HOME/.broski/bin:$PATH" to your shell profile',
				},
	);

	return results;
}
