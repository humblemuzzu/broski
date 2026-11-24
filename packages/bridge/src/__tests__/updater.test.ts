import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkForUpdate, compareSemver, fetchLatestVersion, isUpdateCheckDisabled, performUpdate } from "../updater";

const servers: Array<ReturnType<typeof Bun.serve>> = [];
const dirs: string[] = [];
const savedEnv = {
	noCheck: process.env.BROSKI_NO_UPDATE_CHECK,
	offline: process.env.BROSKI_OFFLINE,
};

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "broski-updater-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	while (servers.length > 0) servers.pop()?.stop(true);
	while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
	if (savedEnv.noCheck === undefined) delete process.env.BROSKI_NO_UPDATE_CHECK;
	else process.env.BROSKI_NO_UPDATE_CHECK = savedEnv.noCheck;
	if (savedEnv.offline === undefined) delete process.env.BROSKI_OFFLINE;
	else process.env.BROSKI_OFFLINE = savedEnv.offline;
});

type ReleaseRoutes = { readonly asset?: Response; readonly atTag?: Response };

/**
 * GitHub as `broski update` sees it: the latest-release redirect to v9.9.9, the installer published with the
 * release, and the installer committed at the tag.
 */
function serveGithub(routes: () => ReleaseRoutes): { base: string; paths: string[] } {
	const paths: string[] = [];
	const server = Bun.serve({
		port: 0,
		fetch(req) {
			const path = new URL(req.url).pathname;
			paths.push(path);
			if (path === "/owner/repo/releases/latest") {
				return new Response(null, { status: 302, headers: { location: "/owner/repo/releases/tag/v9.9.9" } });
			}
			if (path === "/owner/repo/releases/download/v9.9.9/install.sh") return routes().asset ?? notFound();
			if (path === "/raw/owner/repo/v9.9.9/packages/bridge/scripts/install.sh") return routes().atTag ?? notFound();
			return notFound();
		},
	});
	servers.push(server);
	return { base: `http://127.0.0.1:${server.port}`, paths };
}

const notFound = () => new Response("Not Found", { status: 404 });

/** An installer that records the environment `broski update` gives it, then exits with `code`. */
function recordingInstaller(envFile: string, code = 0): Response {
	return new Response(
		`#!/bin/sh\nprintf '%s\\n' "$BROSKI_REPO" "$BROSKI_VERSION" "$BROSKI_BASE_URL" > '${envFile}'\nexit ${code}\n`,
	);
}

async function update(base: string, current = "1.0.0"): Promise<{ ok: boolean; log: string[] }> {
	const log: string[] = [];
	const ok = await performUpdate(current, (line) => log.push(line), {
		repo: "owner/repo",
		baseUrl: base,
		rawOrigin: `${base}/raw`,
		compiled: true,
	});
	return { ok, log };
}

describe("updater: release check and `broski update`", () => {
	test("compareSemver handles leading v, prerelease suffixes, and patch/minor/major bumps", () => {
		expect(compareSemver("0.1.0", "0.2.0")).toBe(-1);
		expect(compareSemver("v0.2.0", "0.2.0")).toBe(0);
		expect(compareSemver("1.0.0", "0.9.9")).toBe(1);
		expect(compareSemver("0.1.0", "0.1.1-beta.1")).toBe(-1);
	});

	test("respects config opt-out and BROSKI_NO_UPDATE_CHECK / BROSKI_OFFLINE", () => {
		delete process.env.BROSKI_NO_UPDATE_CHECK;
		delete process.env.BROSKI_OFFLINE;
		expect(isUpdateCheckDisabled(true)).toBe(false);
		expect(isUpdateCheckDisabled(false)).toBe(true);
		process.env.BROSKI_NO_UPDATE_CHECK = "1";
		expect(isUpdateCheckDisabled(true)).toBe(true);
		delete process.env.BROSKI_NO_UPDATE_CHECK;
		process.env.BROSKI_OFFLINE = "true";
		expect(isUpdateCheckDisabled(true)).toBe(true);
	});

	test("fetchLatestVersion resolves tag from /releases/latest redirect without hitting GitHub API", async () => {
		const server = Bun.serve({
			port: 0,
			fetch(req) {
				const path = new URL(req.url).pathname;
				if (path === "/owner/repo/releases/latest") {
					return new Response(null, {
						status: 302,
						headers: { location: "https://github.com/owner/repo/releases/tag/v0.4.2" },
					});
				}
				return new Response("not found", { status: 404 });
			},
		});
		servers.push(server);
		const baseUrl = `http://127.0.0.1:${server.port}`;

		const latest = await fetchLatestVersion({ repo: "owner/repo", baseUrl });
		expect(latest).toEqual({ version: "0.4.2", tag: "v0.4.2" });

		const check = await checkForUpdate("0.1.0", { enabled: true, repo: "owner/repo", baseUrl });
		expect(check).toEqual({
			updateAvailable: true,
			currentVersion: "0.1.0",
			latestVersion: "0.4.2",
			releaseUrl: `${baseUrl}/owner/repo/releases/tag/v0.4.2`,
		});

		const disabled = await checkForUpdate("0.1.0", { enabled: false, repo: "owner/repo", baseUrl });
		expect(disabled).toBeNull();
	});

	test("broski update runs the installer published with the new release, pointed at that release", async () => {
		const envFile = join(tempDir(), "env");
		const { base, paths } = serveGithub(() => ({ asset: recordingInstaller(envFile) }));
		const { ok } = await update(base);
		expect(ok).toBe(true);
		expect(readFileSync(envFile, "utf8").split("\n").slice(0, 3)).toEqual([
			"owner/repo",
			"v9.9.9",
			`${base}/owner/repo/releases/download/v9.9.9`,
		]);
		expect(paths).not.toContain("/raw/owner/repo/v9.9.9/packages/bridge/scripts/install.sh");
	});

	test("a release without the installer asset uses the installer committed at its tag", async () => {
		const envFile = join(tempDir(), "env");
		const { base } = serveGithub(() => ({ atTag: recordingInstaller(envFile) }));
		const { ok, log } = await update(base);
		expect(ok).toBe(true);
		expect(log.join("\n")).toContain("No installer at");
		expect(readFileSync(envFile, "utf8")).toContain("v9.9.9");
	});

	test("an error page instead of a script is never run", async () => {
		const page = () => new Response("<!DOCTYPE html><title>Rate limited</title>", { status: 200 });
		const { base } = serveGithub(() => ({ asset: page(), atTag: page() }));
		const { ok, log } = await update(base);
		expect(ok).toBe(false);
		expect(log.join("\n")).toContain("Could not download the v9.9.9 installer");
	});

	test("an installer that fails makes the update fail and says how to resume", async () => {
		const envFile = join(tempDir(), "env");
		const { base } = serveGithub(() => ({ asset: recordingInstaller(envFile, 3) }));
		const { ok, log } = await update(base);
		expect(ok).toBe(false);
		expect(log.join("\n")).toContain("Run `broski update` again: it resumes where it stopped.");
	});

	test("on the latest version nothing is downloaded and the update succeeds", async () => {
		const { base, paths } = serveGithub(() => ({}));
		const { ok, log } = await update(base, "9.9.9");
		expect(ok).toBe(true);
		expect(log.join("\n")).toContain("Already on the latest version (v9.9.9)");
		expect(paths).toEqual(["/owner/repo/releases/latest"]);
	});
});
