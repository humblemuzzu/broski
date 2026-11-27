/**
 * The doctor's Antigravity check. Its sources are injected, and the one doctor run here is under a profile without
 * dependencies or agents, with `antigravity.cliPath` naming a script that only notes it was run: no `agy` is started.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SignIn } from "../backends/antigravity/catalog/catalogs";
import { AGY_INSTALL_FIX, AGY_SIGN_IN_FIX } from "../backends/antigravity/install";
import { getDefaultConfig } from "../config";
import { DEFAULT_PORT } from "../config/port";
import { type AgyCheckSources, agyCliCheck } from "../doctor/checks/antigravity";
import { runAllChecks } from "../doctor/checks/index";
import type { DoctorContext } from "../doctor/context";
import { linkPaths } from "../doctor/link-paths";

const AGY = { found: true, path: "/Users/me/.local/bin/agy" } as const;

function sources(signIn: SignIn, faults: string[] = []) {
	const asked: string[] = [];
	const injected: AgyCheckSources = {
		version: async (path) => {
			asked.push(`version ${path}`);
			return { version: "1.5.18" };
		},
		signIn: async (cli) => {
			asked.push(`sign-in ${cli.path}`);
			return { signIn, faults };
		},
	};
	return { asked, injected };
}

let root: string | undefined;

afterEach(() => {
	if (root !== undefined) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

describe("the doctor's agy check", () => {
	test("without agy says it is optional and asks nothing", async () => {
		const { asked, injected } = sources({ kind: "signed_in" });
		const check = await agyCliCheck({ found: false, reason: "agy is not on PATH" }, injected);
		expect(check).toEqual({
			id: "antigravity",
			category: "dependencies",
			status: "info",
			message: "Antigravity CLI not found (optional)",
			details: ["agy is not on PATH"],
		});
		expect(asked).toEqual([]);
	});

	test("with an agy that does not run says so and opens no session", async () => {
		const asked: string[] = [];
		const check = await agyCliCheck(AGY, {
			version: async () => ({ problem: "agy --version exited with code 1" }),
			signIn: async () => {
				asked.push("sign-in");
				return { signIn: { kind: "signed_in" }, faults: [] };
			},
		});
		expect(check).toMatchObject({
			status: "warning",
			details: ["agy --version exited with code 1"],
			fix: AGY_INSTALL_FIX,
		});
		expect(asked).toEqual([]);
	});

	test("names the version and the sign-in agy reports", async () => {
		const signedIn = sources({ kind: "signed_in" });
		expect(await agyCliCheck(AGY, signedIn.injected)).toEqual({
			id: "antigravity",
			category: "dependencies",
			status: "ok",
			message: `Antigravity CLI 1.5.18 (${AGY.path}), signed in`,
		});
		expect(signedIn.asked).toEqual([`version ${AGY.path}`, `sign-in ${AGY.path}`]);
		const signedOut = await agyCliCheck(AGY, sources({ kind: "signed_out", text: "Authentication required" }).injected);
		expect(signedOut).toMatchObject({
			status: "warning",
			message: `Antigravity CLI 1.5.18 (${AGY.path}), not signed in`,
			details: ["Authentication required"],
			fix: AGY_SIGN_IN_FIX,
		});
		const unknown = await agyCliCheck(AGY, sources({ kind: "unknown" }).injected);
		expect(unknown).toMatchObject({
			status: "info",
			message: `Antigravity CLI 1.5.18 (${AGY.path}), sign-in not reported`,
		});
	});

	test("lists what agy sent that the bridge could not read", async () => {
		const failed: SignIn = { kind: "failed", text: "agy did not answer session/new within 60 s" };
		const check = await agyCliCheck(AGY, sources(failed, ["agy sent a line that is not JSON"]).injected);
		expect(check).toMatchObject({
			status: "warning",
			message: `Antigravity CLI 1.5.18 (${AGY.path}), could not open a session`,
			details: ["agy did not answer session/new within 60 s", "agy sent a line that is not JSON"],
		});
	});

	test("is not run by a doctor whose profile has no dependencies", async () => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "broski-doctor-agy-")));
		const script = join(root, "agy");
		writeFileSync(script, '#!/bin/sh\n: > "$0.ran"\n', { mode: 0o755 });
		const home = join(root, ".broski");
		const defaults = getDefaultConfig();
		const ctx: DoctorContext = {
			config: { ...defaults, antigravity: { ...defaults.antigravity, cliPath: script } },
			port: DEFAULT_PORT,
			paths: {
				home,
				bin: join(home, "bin"),
				logs: join(home, "logs"),
				tls: join(home, "tls"),
				tokenFile: join(home, "token.json"),
				logFile: join(home, "logs", "bridge.log"),
				errorLogFile: join(home, "logs", "bridge.error.log"),
				configFile: join(home, "config.json"),
			},
			link: linkPaths(join(home, "link")),
		};
		const checks = await runAllChecks(ctx, { profile: "security" });
		expect(new Set(checks.map((check) => check.category))).toEqual(new Set(["security"]));
		expect(existsSync(`${script}.ran`)).toBe(false);
	}, 60_000);
});
