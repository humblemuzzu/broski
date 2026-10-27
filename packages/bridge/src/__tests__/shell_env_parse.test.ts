/**
 * The parsing and merge rules behind login-shell environment import: what the shell's marked output is read
 * as, and which variable wins once it meets the service environment.
 */

import { describe, expect, test } from "bun:test";
import {
	isRefusingShell,
	mergeShellEnv,
	newMarker,
	parseMarkedEnv,
	SHELL_ENV_FLAG,
	shellArgs,
	shellCommand,
	shellDialect,
} from "../platform/shell-env-parse";

const MARKER = "__BROSKI_SHELL_ENV_test__";

function marked(payload: string, before = "", after = ""): string {
	return `${before}${MARKER}${payload}${MARKER}${after}`;
}

describe("parseMarkedEnv", () => {
	test("reads NUL-separated entries between the markers and ignores rc-file noise on both sides", () => {
		const raw = marked("PATH=/usr/bin:/bin\0EDITOR=vim\0", "p10k instant prompt banner\n", "\nzsh: job control off\n");

		expect(parseMarkedEnv(raw, MARKER)).toEqual({
			ok: true,
			env: { PATH: "/usr/bin:/bin", EDITOR: "vim" },
		});
	});

	test("keeps newlines and further equals signs inside a value", () => {
		const raw = marked("MULTI_LINE=first\nsecond\0EQUALS=a=b=c\0");

		const parsed = parseMarkedEnv(raw, MARKER);

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.env.MULTI_LINE).toBe("first\nsecond");
		expect(parsed.env.EQUALS).toBe("a=b=c");
	});

	test("skips entries that are not NAME=value", () => {
		const raw = marked("GOOD=1\0=orphan\0no-separator\0" + "1BAD=x\0ALSO_GOOD=2\0");

		const parsed = parseMarkedEnv(raw, MARKER);

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(Object.keys(parsed.env).sort()).toEqual(["ALSO_GOOD", "GOOD"]);
	});

	test("a shell that never printed the marker is a failure, not an empty environment", () => {
		expect(parseMarkedEnv("just a banner\n", MARKER)).toEqual({
			ok: false,
			reason: "the shell never printed its environment",
		});
	});

	test("output cut off after the opening marker is reported as truncated", () => {
		expect(parseMarkedEnv(`${MARKER}PATH=/usr/bin\0`, MARKER)).toEqual({
			ok: false,
			reason: "the shell's environment output was truncated",
		});
	});

	test("markers with nothing between them are a failure", () => {
		expect(parseMarkedEnv(marked(""), MARKER)).toEqual({ ok: false, reason: "the shell printed no variables" });
	});
});

describe("shellCommand and markers", () => {
	test("the command echoes the literal marker around env -0", () => {
		expect(shellCommand(MARKER)).toBe(`printf '%s' '${MARKER}'; env -0; printf '%s' '${MARKER}'`);
	});

	test("every run gets its own marker", () => {
		expect(newMarker()).not.toBe(newMarker());
	});
});

describe("shell dialects", () => {
	test("zsh, bash and the POSIX family are asked as interactive login shells", () => {
		for (const shell of ["/bin/zsh", "/usr/local/bin/bash", "/bin/sh", "/usr/bin/dash"]) {
			expect(shellDialect(shell)).not.toBeNull();
			expect(shellArgs(shell, "cmd")).toEqual(["-i", "-l", "-c", "cmd"]);
		}
	});

	test("fish keeps its own flag order", () => {
		expect(shellDialect("/opt/homebrew/bin/fish")).toBe("fish");
		expect(shellArgs("/opt/homebrew/bin/fish", "cmd")).toEqual(["-l", "-i", "-c", "cmd"]);
	});

	test("an unknown shell has no dialect, and a nologin shell is refused", () => {
		expect(shellDialect("/usr/bin/nu")).toBeNull();
		expect(shellDialect("/usr/bin/nushell")).toBeNull();
		expect(isRefusingShell("/usr/bin/nologin")).toBe(true);
		expect(isRefusingShell("/bin/zsh")).toBe(false);
	});
});

describe("mergeShellEnv", () => {
	const serviceEnv: NodeJS.ProcessEnv = {
		HOME: "/Users/service",
		PATH: "/usr/bin:/bin:/opt/homebrew/bin",
		BROSKI_TLS: "1",
		BROSKI_LINK_SOCKET: "/tmp/bridge.sock",
		PI_CODING_AGENT_DIR: "/tmp/agent",
		LANG: "en_US.UTF-8",
	};

	const shellEnv: Record<string, string> = {
		HOME: "/Users/somewhere-else",
		PATH: "/Users/me/bin:/usr/bin:/bin",
		BROSKI_TLS: "0",
		DEEPSEEK_API_KEY: "shell-only-key",
		ZDOTDIR: "/Users/me/.config/zsh",
		PWD: "/",
		OLDPWD: "/tmp",
		SHLVL: "2",
		_: "/bin/env",
		TERM: "xterm-256color",
		TERM_PROGRAM: "iTerm.app",
		ITERM_SESSION_ID: "w0t0p0",
		[SHELL_ENV_FLAG]: "1",
	};

	test("the shell wins for the user's own variables, including PATH", () => {
		const merged = mergeShellEnv(serviceEnv, shellEnv);

		expect(merged.env.DEEPSEEK_API_KEY).toBe("shell-only-key");
		expect(merged.env.ZDOTDIR).toBe("/Users/me/.config/zsh");
		expect(merged.env.PATH?.startsWith("/Users/me/bin:/usr/bin:/bin")).toBe(true);
		expect(merged.imported).toBe(3);
	});

	test("the service keeps the names the bridge owns", () => {
		const merged = mergeShellEnv(serviceEnv, shellEnv);

		expect(merged.env.HOME).toBe("/Users/service");
		expect(merged.env.BROSKI_TLS).toBe("1");
		expect(merged.env.BROSKI_LINK_SOCKET).toBe("/tmp/bridge.sock");
	});

	test("a name only the service environment has survives", () => {
		expect(mergeShellEnv(serviceEnv, shellEnv).env.PI_CODING_AGENT_DIR).toBe("/tmp/agent");
	});

	test("service PATH entries the shell lacks are appended, once", () => {
		const merged = mergeShellEnv(serviceEnv, { ...shellEnv, PATH: "/Users/me/bin:/usr/bin:/bin" });

		expect(merged.env.PATH).toBe("/Users/me/bin:/usr/bin:/bin:/opt/homebrew/bin");
	});

	test("shell-run artefacts are dropped and reported", () => {
		const merged = mergeShellEnv(serviceEnv, shellEnv);

		for (const name of ["PWD", "OLDPWD", "SHLVL", "_", "TERM", "TERM_PROGRAM", "ITERM_SESSION_ID", SHELL_ENV_FLAG]) {
			expect(merged.env[name]).toBeUndefined();
		}
		expect(merged.dropped).toContain("PWD");
		expect(merged.env[SHELL_ENV_FLAG]).toBeUndefined();
	});

	test("a bridge-owned name the shell alone exports is taken in a dev run and refused in a compiled one", () => {
		const shellEnv = { BROSKI_TLS: "0", BUN_INSTALL: "/Users/me/.bun" };

		expect(mergeShellEnv({}, shellEnv).env.BROSKI_TLS).toBe("0");

		const compiled = mergeShellEnv({}, shellEnv, { bridgeNamesFromShell: false });
		expect(compiled.env.BROSKI_TLS).toBeUndefined();
		expect(compiled.env.BUN_INSTALL).toBeUndefined();
	});

	test("a shell with no PATH keeps the service one", () => {
		expect(mergeShellEnv(serviceEnv, { EDITOR: "vim" }).env.PATH).toBe(serviceEnv.PATH ?? "");
	});
});
