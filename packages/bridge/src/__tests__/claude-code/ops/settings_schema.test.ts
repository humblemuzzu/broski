/** A settings file the CLI's schema rejects is skipped whole, valid keys and all: the phone never writes one, and says so when one exists. */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BackendCallResult, EditableFile } from "../../../contract";
import { type OpsWorld, opsWorld } from "./ops-world";

let world: OpsWorld;

afterEach(() => world.cleanup());

function file(fileId: string, change?: { kind: "write"; text: string; revision: string }): Promise<BackendCallResult> {
	return world.call({ kind: "config_file", cwd: world.cwd, fileId, ...(change && { change }) });
}

function fileOf(result: BackendCallResult): EditableFile {
	if (result.status !== "accepted" || result.result.kind !== "config_file") throw new Error(JSON.stringify(result));
	return result.result.file;
}

describe("settings files and the CLI's schema", () => {
	test("refuses a write the schema would make the CLI skip, even though it is valid JSON", async () => {
		world = opsWorld();
		const path = world.write(join(world.cwd, ".claude", "settings.json"), '{"language":"fr"}');
		const read = fileOf(await file("settings:project"));
		for (const text of [
			'{"model":5,"language":"fr"}',
			'{"permissions":{"allow":"Bash"}}',
			'{"hooks":{"PreToolUse":"x"}}',
		]) {
			const refused = await file("settings:project", { kind: "write", text, revision: read.revision });
			expect(refused.status === "rejected" && refused.rejection.code).toBe("invalid_input");
			expect(refused.status === "rejected" && refused.rejection.message).toContain("settings schema");
		}
		expect(readFileSync(path, "utf8")).toBe('{"language":"fr"}');
	});

	test("accepts a valid change, an empty object, and keys the schema does not know", async () => {
		world = opsWorld();
		world.write(join(world.cwd, ".claude", "settings.json"), '{"language":"fr"}');
		let revision = fileOf(await file("settings:project")).revision;
		for (const text of ['{"language":"de","someFutureKey":{"a":[1]}}', "{}", '{"language":"it"}']) {
			const written = fileOf(await file("settings:project", { kind: "write", text, revision }));
			expect(written.text).toBe(text);
			revision = written.revision;
		}
	});

	test("reports a file that parses but loads nothing, and a file that loads, without a problem", async () => {
		world = opsWorld();
		world.write(join(world.cwd, ".claude", "settings.json"), '{"model":5}');
		world.write(join(world.cwd, ".claude", "settings.local.json"), '{"language":"fr"}');
		world.write(join(world.configDir, "settings.json"), "{}");
		const skipped = fileOf(await file("settings:project"));
		expect(skipped.problems.join(" ")).toContain("settings schema");
		expect(fileOf(await file("settings:local")).problems).toEqual([]);
		expect(fileOf(await file("settings:user")).problems).toEqual([]);
	});

	test("lets a skipped file be fixed by a write that satisfies the schema", async () => {
		world = opsWorld();
		world.write(join(world.cwd, ".claude", "settings.json"), '{"model":5}');
		const read = fileOf(await file("settings:project"));
		const fixed = fileOf(
			await file("settings:project", { kind: "write", text: '{"model":"opus"}', revision: read.revision }),
		);
		expect(fixed.problems).toEqual([]);
	});
});
