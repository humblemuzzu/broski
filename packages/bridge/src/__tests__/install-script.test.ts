/**
 * `scripts/install.sh` run for real (sh, curl, tar, gzip, shasum) against a release served on 127.0.0.1, in a
 * temp HOME. `launchctl` is a stand-in on PATH that records its calls, so no test reaches the real launchd.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bridgeScript, buildRelease, linkScript, serveRelease } from "./helpers/release-fixture";

const INSTALL_SH = resolve(import.meta.dir, "../../scripts/install.sh");
const UID = String(process.getuid?.() ?? 501);
const TARGET = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";

const v1 = buildRelease({ version: "1.0.0" });
const v2 = buildRelease({ version: "2.0.0" });
let server: Awaited<ReturnType<typeof serveRelease>>;
const homes: string[] = [];

beforeAll(async () => {
	server = await serveRelease(v1);
});
afterAll(() => server.stop());
afterEach(() => {
	while (homes.length > 0) rmSync(homes.pop() as string, { recursive: true, force: true });
	server.faults.clear();
	server.requests.length = 0;
	server.setRelease(v1);
});

function newHome(): string {
	const home = mkdtempSync(join(tmpdir(), "broski-install-home-"));
	homes.push(home);
	const fakeBin = join(home, "fake-bin");
	mkdirSync(fakeBin);
	writeFileSync(
		join(fakeBin, "launchctl"),
		`#!/bin/sh\necho "$*" >> "$HOME/launchctl-calls"\ncase "$1" in print) [ -f "$HOME/launchd-loaded" ] ;; esac\n`,
	);
	chmodSync(join(fakeBin, "launchctl"), 0o755);
	return home;
}

type RunOptions = {
	readonly shell?: string;
	/** Script text piped to `sh -s`, as `curl ... | sh` does; the file itself when unset. */
	readonly piped?: string;
};

async function install(
	home: string,
	args: string[] = [],
	options: RunOptions = {},
): Promise<{ code: number; out: string }> {
	const argv = options.piped === undefined ? ["/bin/sh", INSTALL_SH, ...args] : ["/bin/sh", "-s", "--", ...args];
	const child = Bun.spawn(argv, {
		env: {
			HOME: home,
			SHELL: options.shell ?? "/bin/zsh",
			PATH: `${join(home, "fake-bin")}:/usr/bin:/bin:/usr/sbin:/sbin`,
			BROSKI_BASE_URL: server.url,
		},
		stdin: options.piped === undefined ? "ignore" : new TextEncoder().encode(options.piped),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { code, out: out + err };
}

const bin = (home: string, name: string) => join(home, ".broski", "bin", name);
const read = (path: string) => readFileSync(path, "utf8");
const assetRequests = () => server.requests.map((r) => r.name).filter((n) => n !== "SHA256SUMS");

/** Where install.sh keeps the partial download of `asset`: named by its checksum, so a later run resumes it. */
function partPath(home: string, asset: string): string {
	const sums = new TextDecoder().decode(v1.get("SHA256SUMS"));
	const sha = sums.split("\n").find((line) => line.endsWith(`  ${asset}`)) ?? "";
	mkdirSync(bin(home, ".staging"), { recursive: true });
	return join(bin(home, ".staging"), `${asset}.${sha.slice(0, 12)}.part`);
}

function serviceFor(home: string, linkPath: string, loaded: boolean): void {
	mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
	writeFileSync(
		join(home, "Library", "LaunchAgents", "com.broski.link.plist"),
		`<plist><dict><key>ProgramArguments</key><array>\n        <string>${linkPath}</string>\n</array></dict></plist>\n`,
	);
	if (loaded) writeFileSync(join(home, "launchd-loaded"), "");
}

describe("install.sh", () => {
	test("a first install takes the .tar.xz copies, verifies them, adds PATH and names the next steps", async () => {
		const home = newHome();
		const { code, out } = await install(home);
		expect(code).toBe(0);
		expect(read(bin(home, "broski"))).toBe(bridgeScript("1.0.0"));
		expect(read(bin(home, "broski-link"))).toBe(linkScript("1.0.0"));
		expect(read(bin(home, "libbroski_pty.dylib"))).toBe("pty 1.0.0");
		expect(assetRequests()).toEqual([`broski-${TARGET}.tar.xz`, `broski-link-${TARGET}.tar.xz`, "libbroski_pty.dylib"]);
		expect(read(join(home, ".zshrc"))).toContain(`export PATH="${join(home, ".broski", "bin")}:$PATH"`);
		expect(out).toContain("Broski v1.0.0 is installed");
		expect(out).toContain("broski-link pair");
		expect(existsSync(bin(home, ".staging"))).toBe(false);
		expect(existsSync(bin(home, ".install.lock"))).toBe(false);
		expect(existsSync(join(home, "launchctl-calls"))).toBe(false);
	});

	test("running it again downloads nothing and says it is up to date", async () => {
		const home = newHome();
		await install(home);
		server.requests.length = 0;
		const { code, out } = await install(home);
		expect(code).toBe(0);
		expect(assetRequests()).toEqual([]);
		expect(out).toContain("Broski v1.0.0 is already installed and up to date");
		expect(read(join(home, ".zshrc")).match(/# Broski/g)?.length).toBe(1);
	});

	test("an update restarts the loaded service that runs ~/.broski/bin and waits for the bridge", async () => {
		const home = newHome();
		await install(home);
		serviceFor(home, bin(home, "broski-link"), true);
		server.setRelease(v2);
		const { code, out } = await install(home);
		expect(code).toBe(0);
		expect(read(bin(home, "broski"))).toBe(bridgeScript("2.0.0"));
		expect(read(join(home, "launchctl-calls"))).toContain(`kickstart -k gui/${UID}/com.broski.link`);
		expect(out).toContain("Broski restarted. Your phone stays paired.");
		expect(out).not.toContain("Next steps");
	});

	test("a service that runs Broski from another folder is left alone", async () => {
		const home = newHome();
		await install(home);
		serviceFor(home, "/Users/me/src/broski/target/release/broski-link", true);
		server.setRelease(v2);
		const { code, out } = await install(home);
		expect(code).toBe(0);
		expect(existsSync(join(home, "launchctl-calls"))).toBe(false);
		expect(out).toContain("runs Broski from another folder");
	});

	test("an installed but unloaded service is reported, not started", async () => {
		const home = newHome();
		await install(home);
		serviceFor(home, bin(home, "broski-link"), false);
		server.setRelease(v2);
		const { out } = await install(home);
		expect(read(join(home, "launchctl-calls"))).not.toContain("kickstart");
		expect(out).toContain("Start it with: broski restart");
	});

	test("a connection that drops mid-download resumes from the bytes on disk", async () => {
		const home = newHome();
		server.faults.set(`broski-${TARGET}.tar.xz`, "drop-once");
		const { code, out } = await install(home);
		expect(code).toBe(0);
		const tries = server.requests.filter((r) => r.name === `broski-${TARGET}.tar.xz`);
		expect(tries).toHaveLength(2);
		expect(tries[1]?.range).toMatch(/^bytes=[1-9]\d*-$/);
		expect(out).toContain("the connection dropped; resuming in");
		expect(read(bin(home, "broski"))).toBe(bridgeScript("1.0.0"));
	});

	test("a run that was stopped resumes its partial download on the next run", async () => {
		const home = newHome();
		const asset = `broski-${TARGET}.tar.xz`;
		const bytes = v1.get(asset) as Uint8Array;
		const half = Math.floor(bytes.length / 2);
		expect(half).toBeGreaterThan(50_000);
		writeFileSync(partPath(home, asset), bytes.subarray(0, half));
		writeFileSync(bin(home, ".staging/broski.new"), "left by a killed run");
		const { code } = await install(home);
		expect(code).toBe(0);
		expect(server.requests.find((r) => r.name === asset)?.range).toBe(`bytes=${half}-`);
		expect(read(bin(home, "broski"))).toBe(bridgeScript("1.0.0"));
	});

	test("a saved partial that cannot resume (416) starts over", async () => {
		const home = newHome();
		writeFileSync(partPath(home, `broski-link-${TARGET}.tar.xz`), new Uint8Array(4 * 1024 * 1024));
		const { code, out } = await install(home);
		expect(code).toBe(0);
		expect(out).toMatch(/(saved partial download was stale|did not match its checksum); starting again/);
		expect(read(bin(home, "broski-link"))).toBe(linkScript("1.0.0"));
	});

	test("a download that does not match its checksum is fetched again", async () => {
		const home = newHome();
		server.faults.set(`broski-${TARGET}.tar.xz`, "corrupt-once");
		const { code, out } = await install(home);
		expect(code).toBe(0);
		expect(out).toContain("the download did not match its checksum; starting again in");
		expect(read(bin(home, "broski"))).toBe(bridgeScript("1.0.0"));
	});

	test("an archive that unpacks to the wrong bytes replaces nothing", async () => {
		const home = newHome();
		await install(home);
		server.setRelease(buildRelease({ version: "2.0.0", mispackedBridge: true }));
		const { code, out } = await install(home);
		expect(code).toBe(1);
		expect(out).toContain("unpacked to the wrong bytes");
		expect(read(bin(home, "broski"))).toBe(bridgeScript("1.0.0"));
		expect(read(bin(home, "broski-link"))).toBe(linkScript("1.0.0"));
	});

	test("a new broski that does not start on this Mac replaces nothing", async () => {
		const home = newHome();
		await install(home);
		server.setRelease(buildRelease({ version: "2.0.0", brokenBridge: true }));
		const { code, out } = await install(home);
		expect(code).toBe(1);
		expect(out).toContain("the new broski did not start on this Mac, so nothing was replaced");
		expect(out).toContain("dyld: Symbol not found");
		expect(read(bin(home, "broski"))).toBe(bridgeScript("1.0.0"));
		expect(read(bin(home, "broski-link"))).toBe(linkScript("1.0.0"));
		expect(existsSync(join(bin(home, ".staging"), "broski.new"))).toBe(false);
	});

	test("a release without .tar.xz installs from .gz, and one without either from the raw files", async () => {
		const gzHome = newHome();
		server.setRelease(buildRelease({ version: "1.0.0", compressed: ["gz"] }));
		expect((await install(gzHome)).code).toBe(0);
		expect(assetRequests()).toContain(`broski-${TARGET}.gz`);
		expect(read(bin(gzHome, "broski"))).toBe(bridgeScript("1.0.0"));

		server.requests.length = 0;
		const rawHome = newHome();
		server.setRelease(buildRelease({ version: "1.0.0", compressed: [] }));
		expect((await install(rawHome)).code).toBe(0);
		expect(assetRequests()).toContain(`broski-${TARGET}`);
		expect(read(bin(rawHome, "broski"))).toBe(bridgeScript("1.0.0"));
	});

	test("an asset missing from the release fails at once and names it", async () => {
		const home = newHome();
		await install(home);
		server.setRelease(v2);
		server.faults.set(`broski-link-${TARGET}.tar.xz`, "missing");
		const started = Date.now();
		const { code, out } = await install(home);
		expect(code).toBe(1);
		expect(Date.now() - started).toBeLessThan(5_000);
		expect(out).toContain(`broski-link-${TARGET}.tar.xz is not in the release (HTTP 404`);
		expect(read(bin(home, "broski"))).toBe(bridgeScript("1.0.0"));
	});

	test("a second installer refuses while the first runs, and takes over a dead one's lock", async () => {
		const home = newHome();
		mkdirSync(bin(home, ".install.lock"), { recursive: true });
		writeFileSync(join(bin(home, ".install.lock"), "pid"), String(process.pid));
		const busy = await install(home);
		expect(busy.code).toBe(1);
		expect(busy.out).toContain(`another Broski install or update is running (process ${process.pid})`);

		writeFileSync(join(bin(home, ".install.lock"), "pid"), "999999");
		expect((await install(home)).code).toBe(0);
	});

	test("--install-service registers the service on a first install", async () => {
		const home = newHome();
		const { code } = await install(home, ["--install-service"]);
		expect(code).toBe(0);
		expect(read(join(home, "broski-calls"))).toContain("install");
	});

	test("--install-service on an up-to-date install still registers the missing service", async () => {
		const home = newHome();
		await install(home);
		const { code, out } = await install(home, ["--install-service"]);
		expect(code).toBe(0);
		expect(out).toContain("already installed and up to date");
		expect(read(join(home, "broski-calls"))).toContain("install");
	});

	test("a config warning printed before the version line does not fail the smoke test", async () => {
		const home = newHome();
		server.setRelease(buildRelease({ version: "1.0.0", configWarning: true }));
		const { code, out } = await install(home);
		expect(code).toBe(0);
		expect(out).toContain("Broski v1.0.0 is installed");
	});

	test("files earlier installers and updaters left next to the binaries are cleared", async () => {
		const home = newHome();
		mkdirSync(bin(home, ""), { recursive: true });
		for (const name of [".broski-backup-1-ab", ".broski-part-1-cd", "broski.0123456789ab.gz.part", "SHA256SUMS"]) {
			writeFileSync(bin(home, name), "old");
		}
		expect((await install(home)).code).toBe(0);
		for (const name of [".broski-backup-1-ab", ".broski-part-1-cd", "broski.0123456789ab.gz.part", "SHA256SUMS"]) {
			expect(existsSync(bin(home, name))).toBe(false);
		}
	});

	test("--uninstall removes the binaries and the PATH entry and keeps the pairing", async () => {
		const home = newHome();
		await install(home);
		mkdirSync(join(home, ".broski", "link"), { recursive: true });
		writeFileSync(join(home, ".broski", "link", "identity"), "keep me");
		const { code } = await install(home, ["--uninstall"]);
		expect(code).toBe(0);
		expect(existsSync(bin(home, "broski"))).toBe(false);
		expect(read(join(home, ".zshrc"))).not.toContain(".broski/bin");
		expect(read(join(home, ".broski", "link", "identity"))).toBe("keep me");
	});

	test("a script cut short while `curl | sh` downloads it changes nothing", async () => {
		const script = read(INSTALL_SH);
		const lastLine = script.lastIndexOf('main "$@"');
		for (const cut of [Math.floor(script.length / 3), Math.floor(script.length / 2), lastLine]) {
			const home = newHome();
			await install(home, [], { piped: script.slice(0, cut) });
			expect(existsSync(join(home, ".broski"))).toBe(false);
		}
		const home = newHome();
		expect((await install(home, [], { piped: script })).code).toBe(0);
		expect(read(bin(home, "broski"))).toBe(bridgeScript("1.0.0"));
	});

	test("bash users get PATH in ~/.bash_profile, which Terminal's login shell reads, and uninstall removes it", async () => {
		const home = newHome();
		expect((await install(home, [], { shell: "/bin/bash" })).code).toBe(0);
		expect(read(join(home, ".bash_profile"))).toContain(`export PATH="${bin(home, "")}`);
		expect((await install(home, ["--uninstall"], { shell: "/bin/bash" })).code).toBe(0);
		expect(read(join(home, ".bash_profile"))).not.toContain(".broski/bin");
	});

	test("an unknown option is refused before anything is touched", async () => {
		const home = newHome();
		const { code, out } = await install(home, ["--frobnicate"]);
		expect(code).toBe(64);
		expect(out).toContain("Unknown option: --frobnicate");
		expect(existsSync(join(home, ".broski"))).toBe(false);
	});
});
