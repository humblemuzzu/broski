/** The spike probes that read `~/.claude` or `~/.broski` refuse to start unless the home they read is a temp dir. */

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const GUARD = resolve(import.meta.dir, "../../../../scripts/cc-spike/temp-home-guard.ts");
const SCRIPT = `import { refuseRealHome } from ${JSON.stringify(GUARD)}; refuseRealHome("probe"); console.log("ran");`;
/** Stands for a real home: outside every temp dir, and nothing there is ever read. */
const NOT_TEMP = "/nonexistent-broski-home";

let temp: string | undefined;

afterEach(() => {
	if (temp !== undefined) rmSync(temp, { recursive: true, force: true });
	temp = undefined;
});

function run(env: Record<string, string>): { code: number; out: string } {
	const child = Bun.spawnSync([process.execPath, "-e", SCRIPT], {
		env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir(), ...env },
	});
	return { code: child.exitCode, out: `${child.stdout}${child.stderr}` };
}

test("a home outside the temp dirs is refused before the probe does anything", () => {
	const refused = run({ HOME: NOT_TEMP });
	expect(refused.code).toBe(2);
	expect(refused.out).toContain("refusing to run");
	expect(refused.out).not.toContain("ran");
});

test("a temp home runs, and a config dir outside the temp dirs beside it is still refused", () => {
	temp = mkdtempSync(join(tmpdir(), "broski-probe-home-"));
	expect(run({ HOME: temp })).toEqual({ code: 0, out: "ran\n" });
	expect(run({ HOME: temp, CLAUDE_CONFIG_DIR: join(NOT_TEMP, ".claude") }).code).toBe(2);
});
