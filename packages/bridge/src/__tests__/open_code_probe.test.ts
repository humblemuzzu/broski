import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeOpenCodeProbe, probeOpenCode } from "../serve/open-code-probe";

const dirs: string[] = [];

/** A PATH directory holding an `opencode` whose `--version` and `serve` behave as the script says. */
function pathWith(serveScript: string): NodeJS.ProcessEnv {
	const dir = mkdtempSync(join(tmpdir(), "broski-opencode-probe-"));
	dirs.push(dir);
	const binary = join(dir, "opencode");
	writeFileSync(
		binary,
		`#!/bin/sh\nif [ "$1" = "--version" ]; then echo "opencode v9.9.9"; exit 0; fi\n${serveScript}\n`,
	);
	chmodSync(binary, 0o755);
	return { PATH: dir };
}

afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("probeOpenCode", () => {
	test("a PATH without opencode says so", async () => {
		const probe = await probeOpenCode({ PATH: tmpdir() });

		expect(probe.binary).toBeNull();
		expect(describeOpenCodeProbe(probe)).toBe("`opencode` is not on the bridge's PATH");
	});

	test("a release that prints another listening banner is named as unsupported", async () => {
		const probe = await probeOpenCode(pathWith('echo "server listening on http://127.0.0.1:4242"; sleep 5'));

		expect(probe.foreignBanner).toBe(true);
		expect(probe.version).toBe("opencode v9.9.9");
		const message = describeOpenCodeProbe(probe);
		expect(message).toContain("opencode v9.9.9");
		expect(message).toContain('prints "server listening on http://127.0.0.1:4242"');
		expect(message).toContain("not supported by this bridge");
	});

	test("the banner the SDK waits for is not foreign", async () => {
		const probe = await probeOpenCode(pathWith('echo "opencode server listening on http://127.0.0.1:4242"; sleep 5'));

		expect(probe.foreignBanner).toBe(false);
	});

	test("a binary that exits reports its exit code and what it printed", async () => {
		const probe = await probeOpenCode(pathWith('echo "config is invalid" >&2; exit 3'));

		expect(probe.exitCode).toBe(3);
		expect(describeOpenCodeProbe(probe)).toContain('exited with code 3 after printing "config is invalid"');
	});
});
