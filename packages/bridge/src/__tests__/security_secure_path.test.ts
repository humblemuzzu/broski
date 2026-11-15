/** Why the path policy refuses a path it cannot resolve: only a path that is not there is `missing`. */

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveSecurePath } from "../security";
import { tempDirectory } from "./helpers/workspace-rig";

const root = tempDirectory("broski-secure-path-");

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("resolveSecurePath refusals", () => {
	test("a path that is not there, or has a file where a folder should be, is missing", async () => {
		writeFileSync(join(root, "file"), "x");
		expect(await resolveSecurePath(join(root, "nowhere"))).toEqual({ refused: "missing" });
		expect(await resolveSecurePath(join(root, "file", "below"))).toEqual({ refused: "missing" });
	});

	test("a symbolic link loop is a loop, not a missing path", async () => {
		symlinkSync(join(root, "b"), join(root, "a"));
		symlinkSync(join(root, "a"), join(root, "b"));
		expect(await resolveSecurePath(join(root, "a"))).toEqual({ refused: "loop" });
	});

	test.skipIf(process.getuid?.() === 0)("a folder the system does not let the bridge into is denied", async () => {
		mkdirSync(join(root, "locked", "inside"), { recursive: true });
		chmodSync(join(root, "locked"), 0o000);
		try {
			expect(await resolveSecurePath(join(root, "locked", "inside"))).toEqual({ refused: "denied" });
		} finally {
			chmodSync(join(root, "locked"), 0o700);
		}
	});

	test("a name longer than the file system allows is a path the bridge cannot use", async () => {
		expect(await resolveSecurePath(join(root, "n".repeat(300)))).toEqual({ refused: "invalid" });
	});
});
