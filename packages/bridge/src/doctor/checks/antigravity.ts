import { homedir } from "node:os";
import { join } from "node:path";
import packageMeta from "../../../package.json";
import { type CliVersionRead, readCliVersion } from "../../adapter-kit/cli-version";
import { type SignIn, signInOf } from "../../backends/antigravity/catalog/catalogs";
import { probeSession } from "../../backends/antigravity/catalog/probe";
import { AGY_INSTALL_FIX, AGY_SIGN_IN_FIX, type AgyCli, presenceDirOf } from "../../backends/antigravity/install";
import { ShortJobs } from "../../backends/antigravity/jobs";
import type { BroskiConfig } from "../../config";
import { bridgeEnv } from "../../platform/shell-env";
import { resolveAgyCli } from "../../server/antigravity-cli-path";
import type { CheckResult } from "../types";

type FoundAgy = Extract<AgyCli, { found: true }>;

/** The sign-in, and what `agy` sent while it was read that breaks the protocol. */
export interface AgySignInRead {
	readonly signIn: SignIn;
	readonly faults: readonly string[];
}

export interface AgyCheckSources {
	readonly version: (path: string) => Promise<CliVersionRead>;
	readonly signIn: (cli: FoundAgy) => Promise<AgySignInRead>;
}

const SOURCES: AgyCheckSources = { version: readCliVersion, signIn: readSignIn };
const BASE = { id: "antigravity", category: "dependencies" } as const;

export async function runAntigravityChecks(config?: BroskiConfig): Promise<CheckResult[]> {
	return [await agyCliCheck(resolveAgyCli(config?.antigravity.cliPath))];
}

/** The doctor's view of the `agy` the bridge would run: where it is, its version, and its sign-in. */
export async function agyCliCheck(cli: AgyCli, sources: AgyCheckSources = SOURCES): Promise<CheckResult> {
	if (!cli.found) {
		return { ...BASE, status: "info", message: "Antigravity CLI not found (optional)", details: [cli.reason] };
	}
	const ran = await sources.version(cli.path);
	if ("problem" in ran) {
		return {
			...BASE,
			status: "warning",
			message: `agy does not run (${cli.path})`,
			details: [ran.problem],
			fix: AGY_INSTALL_FIX,
		};
	}
	const read = await sources.signIn(cli);
	const check = signInCheck(`Antigravity CLI ${ran.version} (${cli.path})`, read.signIn);
	if (read.faults.length === 0) return check;
	return { ...check, details: [...(check.details ?? []), ...read.faults] };
}

function signInCheck(named: string, signIn: SignIn): CheckResult {
	switch (signIn.kind) {
		case "signed_in":
			return { ...BASE, status: "ok", message: `${named}, signed in` };
		case "signed_out":
			return {
				...BASE,
				status: "warning",
				message: `${named}, not signed in`,
				details: [signIn.text],
				fix: AGY_SIGN_IN_FIX,
			};
		case "failed":
			return { ...BASE, status: "warning", message: `${named}, could not open a session`, details: [signIn.text] };
		case "unknown":
			return { ...BASE, status: "info", message: `${named}, sign-in not reported` };
	}
}

/** Asks `agy` as the bridge does: one session in the bridge's empty folder, closed as soon as it is open. */
async function readSignIn(cli: FoundAgy): Promise<AgySignInRead> {
	const env = bridgeEnv();
	const voidDir = join(homedir(), ".broski", "antigravity", "void");
	const faults: string[] = [];
	const jobs = new ShortJobs(
		{ cli, env, voidDir, presenceDir: presenceDirOf(env) },
		{ name: "broski", version: packageMeta.version },
		(message) => faults.push(message),
	);
	try {
		return { signIn: signInOf(await probeSession(jobs, voidDir)), faults };
	} finally {
		await jobs.dispose();
	}
}
