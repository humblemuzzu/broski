/**
 * Resolving the login shell for real: a temp HOME holds the rc file, so no case here can read the developer's
 * own `~/.zshrc`. Values in these tests are invented strings, never anything from the running environment.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyServiceShellEnv,
	isServiceStart,
	resolveShellBinary,
	resolvesRealHome,
	SHELL_ENV_TIMEOUT_MS,
	type ShellEnvLog,
} from "../platform/shell-env";
import { resolveUserShellEnv } from "../platform/shell-env-resolve";
import { realHomeDir } from "../safety/real-home-guard";

const ZSH = "/bin/zsh";
const BASH = "/bin/bash";

const tempDirs: string[] = [];

function tempHome(rcFileName: string, rc: string): string {
	const home = mkdtempSync(join(tmpdir(), "broski-shell-env-"));
	tempDirs.push(home);
	writeFileSync(join(home, rcFileName), rc);
	return home;
}

/** The service manager's environment: a PATH and a HOME, nothing else. */
function serviceEnv(home: string): NodeJS.ProcessEnv {
	return { HOME: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", SHELL: ZSH };
}

function recorder(): ShellEnvLog & { infos: string[]; warns: string[] } {
	const infos: string[] = [];
	const warns: string[] = [];
	return {
		infos,
		warns,
		info: (message: string) => infos.push(message),
		warn: (message: string) => warns.push(message),
	};
}

afterEach(() => {
	// The temp trees live under the OS temp dir; the preload's temp root is removed at exit.
});

describe("resolveUserShellEnv", () => {
	test.skipIf(!existsSync(ZSH))(
		"imports what a temp ~/.zshrc exports, through banners on both sides of the marker",
		async () => {
			const home = tempHome(
				".zshrc",
				[
					'echo "banner noise on stdout"',
					'echo "more noise" >&2',
					"export BROSKI_TEST_SECRET_KEY=shell-value",
					'export PATH="$HOME/bin:$PATH"',
					'export MULTILINE="line one',
					'line two"',
					"",
				].join("\n"),
			);

			const resolved = await resolveUserShellEnv({ shell: ZSH, env: serviceEnv(home) });

			expect(resolved.ok).toBe(true);
			if (!resolved.ok) return;
			expect(resolved.shell).toBe(ZSH);
			expect(resolved.env.BROSKI_TEST_SECRET_KEY).toBe("shell-value");
			expect(resolved.env.MULTILINE).toBe("line one\nline two");
			expect(resolved.env.PATH?.startsWith(`${home}/bin:`)).toBe(true);
			expect(resolved.durationMs).toBeLessThan(SHELL_ENV_TIMEOUT_MS);
		},
	);

	test.skipIf(!existsSync(BASH))("imports what a temp ~/.bashrc exports from bash too", async () => {
		const home = tempHome(".bashrc", 'export BROSKI_TEST_SECRET_KEY=shell-value\nexport PATH="$HOME/bin:$PATH"\n');
		writeFileSync(join(home, ".bash_profile"), '. "$HOME/.bashrc"\n');

		const resolved = await resolveUserShellEnv({ shell: BASH, env: serviceEnv(home) });

		expect(resolved.ok).toBe(true);
		if (!resolved.ok) return;
		expect(resolved.env.BROSKI_TEST_SECRET_KEY).toBe("shell-value");
		expect(resolved.env.PATH?.startsWith(`${home}/bin:`)).toBe(true);
	});

	test.skipIf(Bun.which("fish") === null)("imports what a temp fish config exports", async () => {
		const home = mkdtempSync(join(tmpdir(), "broski-shell-env-fish-"));
		tempDirs.push(home);
		mkdirSync(join(home, ".config", "fish"), { recursive: true });
		writeFileSync(
			join(home, ".config", "fish", "config.fish"),
			"set -gx BROSKI_TEST_SECRET_KEY shell-value\nset -gx PATH $HOME/bin $PATH\n",
		);

		const resolved = await resolveUserShellEnv({ shell: Bun.which("fish") ?? "fish", env: serviceEnv(home) });

		expect(resolved.ok).toBe(true);
		if (!resolved.ok) return;
		expect(resolved.env.BROSKI_TEST_SECRET_KEY).toBe("shell-value");
		expect(resolved.env.PATH?.startsWith(`${home}/bin`)).toBe(true);
	});

	test.skipIf(!existsSync(ZSH))("a slow rc file is killed at the timeout and reported, not waited out", async () => {
		const home = tempHome(".zshrc", "sleep 30\nexport LATE=never\n");

		const started = Date.now();
		const resolved = await resolveUserShellEnv({ shell: ZSH, env: serviceEnv(home), timeoutMs: 400 });
		const elapsed = Date.now() - started;

		expect(resolved.ok).toBe(false);
		if (resolved.ok) return;
		expect(resolved.reason).toContain("did not finish within 400ms");
		expect(elapsed).toBeLessThan(5_000);
	});

	test.skipIf(!existsSync(ZSH))("output past the byte bound is cut off and reported", async () => {
		const home = tempHome(".zshrc", "export BIG=$(head -c 4096 /dev/zero | tr '\\0' 'a')\n");

		const resolved = await resolveUserShellEnv({ shell: ZSH, env: serviceEnv(home), maxBytes: 256 });

		expect(resolved.ok).toBe(false);
		if (resolved.ok) return;
		expect(resolved.reason).toContain("more than 256 bytes");
	});

	test("a shell that prints nothing useful fails with a reason instead of throwing", async () => {
		const home = mkdtempSync(join(tmpdir(), "broski-shell-env-empty-"));
		tempDirs.push(home);
		const fakeShell = join(home, "dash");
		writeFileSync(fakeShell, "#!/bin/sh\nexit 0\n");
		chmodSync(fakeShell, 0o755);

		const resolved = await resolveUserShellEnv({ shell: fakeShell, env: serviceEnv(home) });

		expect(resolved.ok).toBe(false);
		if (resolved.ok) return;
		expect(resolved.reason).toBe("the shell never printed its environment");
	});
});

describe("resolveShellBinary", () => {
	test("the requested shell wins over $SHELL", () => {
		const choice = resolveShellBinary({ shell: ZSH, env: { SHELL: BASH } });

		expect(choice).toEqual({ ok: true, shell: ZSH });
	});

	test("an unsupported shell is refused by name, with no throw", () => {
		const home = mkdtempSync(join(tmpdir(), "broski-shell-env-refuse-"));
		tempDirs.push(home);
		const unsupported = join(home, "nushell");
		writeFileSync(unsupported, "#!/bin/sh\nexit 0\n");
		chmodSync(unsupported, 0o755);

		const choice = resolveShellBinary({ shell: unsupported, env: {} });

		expect(choice.ok).toBe(false);
		if (choice.ok) return;
		expect(choice.reason).toContain("not a supported login shell");
	});

	test("a path that is not executable is refused", () => {
		const choice = resolveShellBinary({ shell: "/nonexistent/nologin", env: { SHELL: ZSH } });

		expect(choice.ok).toBe(false);
		if (choice.ok) return;
		expect(choice.reason).toContain("not an executable shell");
	});
});

describe("applyServiceShellEnv", () => {
	test("an interactive bridge leaves process.env alone", async () => {
		const log = recorder();
		const target: NodeJS.ProcessEnv = { HOME: "/tmp/whatever", PATH: "/usr/bin:/bin" };

		const applied = await applyServiceShellEnv(log, { target, isTty: true, shell: ZSH });

		expect(applied).toBeNull();
		expect(target).toEqual({ HOME: "/tmp/whatever", PATH: "/usr/bin:/bin" });
		expect(log.infos).toHaveLength(0);
		expect(log.warns).toHaveLength(0);
	});

	test("service mode is the daemon flags or the absence of a TTY", () => {
		expect(isServiceStart({ daemon: true })).toBe(true);
		expect(isServiceStart({ linkSocket: "/tmp/bridge.sock" })).toBe(true);
		expect(isServiceStart({ isTty: false })).toBe(true);
		expect(isServiceStart({ isTty: true })).toBe(false);
	});

	test.skipIf(!existsSync(ZSH))("a service-mode import writes the shell env into the target", async () => {
		const home = tempHome(
			".zshrc",
			'export BROSKI_TEST_SECRET_KEY=shell-value\nexport PATH="$HOME/bin:$PATH"\nexport PWD_NOISE=1\n',
		);
		const target = serviceEnv(home);
		const log = recorder();

		const applied = await applyServiceShellEnv(log, { target, daemon: true });

		expect(applied?.ok).toBe(true);
		expect(target.BROSKI_TEST_SECRET_KEY).toBe("shell-value");
		expect(target.HOME).toBe(home);
		expect(target.PATH?.startsWith(`${home}/bin:`)).toBe(true);
		expect(target.PATH).toContain("/usr/bin");
		expect(target.OLDPWD).toBeUndefined();
		expect(target.PWD).toBeUndefined();
		expect(log.warns).toHaveLength(0);
		expect(log.infos).toHaveLength(1);
		expect(log.infos[0]).toContain("imported");
		expect(log.infos[0]).toContain(ZSH);
		expect(log.infos[0]).not.toContain("shell-value");
	});

	test.skipIf(!existsSync(ZSH))(
		"what the bridge's starter carried reaches neither the user's shell nor the agents, and is named in the log",
		async () => {
			const home = tempHome(
				".zshrc",
				'export SAW_ROLE="$PI_SUBAGENT_TOOLS"\nexport BROSKI_TEST_SECRET_KEY=shell-value\n',
			);
			const target: NodeJS.ProcessEnv = { ...serviceEnv(home), PI_SUBAGENT_TOOLS: "read,chad", CLAUDECODE: "1" };
			const log = recorder();

			const applied = await applyServiceShellEnv(log, { target, daemon: true });

			expect(applied?.ok).toBe(true);
			expect(target.SAW_ROLE).toBe("");
			expect(target.PI_SUBAGENT_TOOLS).toBeUndefined();
			expect(target.CLAUDECODE).toBeUndefined();
			expect(target.BROSKI_TEST_SECRET_KEY).toBe("shell-value");
			expect(log.infos[1]).toBe(
				"[shell-env] left out 2 variables the bridge was started with: CLAUDECODE, PI_SUBAGENT_TOOLS",
			);
			expect(log.infos.join("\n")).not.toContain("read,chad");
		},
	);

	test.skipIf(!existsSync(ZSH))(
		"a failing shell leaves the service environment standing, with one warning",
		async () => {
			const home = tempHome(".zshrc", "sleep 30\n");
			const target = serviceEnv(home);
			const log = recorder();

			const applied = await applyServiceShellEnv(log, { target, daemon: true, timeoutMs: 400 });

			expect(applied?.ok).toBe(false);
			expect(target).toEqual(serviceEnv(home));
			expect(log.warns).toHaveLength(1);
			expect(log.warns[0]).toContain("continuing with the service environment");
			expect(log.warns[0]).not.toContain("sleep 30");
		},
	);

	test("an isolated run pointed at the real home never reads it", async () => {
		const log = recorder();
		const target: NodeJS.ProcessEnv = { HOME: realHomeDir(), PATH: "/usr/bin:/bin" };

		expect(resolvesRealHome(target)).toBe(true);

		const applied = await applyServiceShellEnv(log, { target, daemon: true });

		expect(applied).toBeNull();
		expect(log.infos[0]).toContain("isolated");
		expect(target).toEqual({ HOME: realHomeDir(), PATH: "/usr/bin:/bin" });
	});
});
