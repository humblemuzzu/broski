/**
 * A `trash` command first on PATH, so a session deleted by a test is moved into the test's own directory
 * and never into the developer's Trash (the adapter spawns `trash <file>` and finds it through PATH).
 */

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PiTestEnv } from "./pi-test-env";

export interface FakeTrash {
	/** Every path `trash` was called with, in order. */
	calls(): string[];
	/** Where the files it was given went. */
	readonly directory: string;
	trashed(): string[];
}

export function installFakeTrash(env: PiTestEnv): FakeTrash {
	const bin = join(env.root, "fake-bin");
	const directory = join(env.root, "trashed");
	const log = join(env.root, "trash-calls.log");
	mkdirSync(bin);
	mkdirSync(directory);
	writeFileSync(log, "");
	const command = join(bin, "trash");
	writeFileSync(command, `#!/bin/sh\nprintf '%s\\n' "$1" >> '${log}'\nexec /bin/mv "$1" '${directory}/'\n`);
	chmodSync(command, 0o755);
	process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
	checkItComesFirst(bin);
	return {
		directory,
		calls: () =>
			readFileSync(log, "utf8")
				.split("\n")
				.filter((line) => line !== ""),
		trashed: () => readdirSync(directory),
	};
}

/** `execvp`'s own rule: the first PATH directory holding an executable `trash` wins, and it must be ours. */
function checkItComesFirst(bin: string): void {
	const first = (process.env.PATH ?? "")
		.split(":")
		.find((directory) => directory !== "" && existsSync(join(directory, "trash")));
	if (first !== bin) throw new Error(`a test could reach the real Trash: \`trash\` is first found in ${first}`);
}
