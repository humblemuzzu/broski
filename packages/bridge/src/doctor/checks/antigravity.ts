import { homedir } from "node:os";
import { join } from "node:path";
import packageMeta from "../../../package.json";
import { type CliVersionRead, readCliVersion } from "../../adapter-kit/cli-version";
import { type SignIn, signInOf } from "../../backends/antigravity/catalog/catalogs";
import { probeCatalog } from "../../backends/antigravity/catalog/probe";
import { AGY_INSTALL_FIX, AGY_SIGN_IN_FIX, type AgyCli, presenceDirOf } from "../../backends/antigravity/install";
import { ShortJobs } from "../../backends/antigravity/jobs";
import type { BroskiConfig } from "../../config";
import { bridgeEnv } from "../../platform/shell-env";
import { resolveAgyCli } from "../../server/antigravity-cli-path";
import type { CheckResult } from "../types";

export interface AgyCheckSources {
	readonly version: (path: string) => Promise<CliVersionRead>;
	readonly signIn: (cli: Extract<AgyCli, { found: true }>) => Promise<SignIn>;
}

const SOURCES: AgyCheckSources = { version: readCliVersion, signIn: probeSignIn };

export async function runAntigravityChecks(config?: BroskiConfig): Promise<CheckResult[]> {
	return [await agyCliCheck(resolveAgyCli(config?.antigravity.cliPath))];
}

/** The doctor's view of the `agy` the bridge would run: where it is, its version, and its sign-in as a probe finds it. */
export async function agyCliCheck(cli: AgyCli, sources: AgyCheckSources = SOURCES): Promise<CheckResult> {
	const base = { id: "antigravity", category: "dependencies" as const };
	if (!cli.found)
		return { ...base, status: "info", message: "Antigravity CLI not found (optional)", details: [cli.reason] };
	const ran = await sources.version(cli.path);
	if ("problem" in ran) {
		return {
			...base,
			status: "warning",
			message: `agy does not run (${cli.path})`,
			details: [ran.problem],
			fix: AGY_INSTALL_FIX,
		};
	}
	const named = `Antigravity CLI ${ran.version} (${cli.path})`;
	const signIn = await sources.signIn(cli);
	switch (signIn.kind) {
		case "signed_in":
			return { ...base, status: "ok", message: `${named}, signed in` };
		case "signed_out":
			return {
				...base,
				status: "warning",
				message: `${named}, not signed in`,
				details: [signIn.text],
				fix: AGY_SIGN_IN_FIX,
			};
		case "failed":
			return { ...base, status: "warning", message: `${named}, could not open a session`, details: [signIn.text] };
		case "unknown":
			return { ...base, status: "info", message: `${named}, sign-in not reported` };
	}
}

/** Asks `agy` as the bridge does: one probe session in the bridge's empty folder, closed at once. */
async function probeSignIn(cli: Extract<AgyCli, { found: true }>): Promise<SignIn> {
	const env = bridgeEnv();
	const voidDir = join(homedir(), ".broski", "antigravity", "void");
	const jobs = new ShortJobs(
		{ cli, env, voidDir, presenceDir: presenceDirOf(env) },
		{ name: "broski", version: packageMeta.version },
	);
	try {
		return signInOf(await probeCatalog(jobs, voidDir));
	} finally {
		await jobs.dispose();
	}
}
