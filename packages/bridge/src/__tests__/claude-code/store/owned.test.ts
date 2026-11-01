/** D17, D37: the owner journal is bounded, survives a restart, and records exactly the prompts this bridge sent. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOwnership } from "../../../backends/claude-code/owned";
import { createClaudeCodeServices } from "../../../backends/claude-code/services";
import { fakeClaudeSdk } from "../helpers/fake-claude-sdk";

let root: string;
beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "broski-cc-owned-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function journal(stateDir = join(root, "state")) {
	const services = createClaudeCodeServices({
		cli: { found: false, reason: "n/a" },
		env: {},
		stateDir,
		clientApp: "broski/test",
		sdk: fakeClaudeSdk(),
	});
	return createOwnership({ services });
}

describe("the owner journal", () => {
	test("a session is broski's exactly when it was claimed, also after a restart", async () => {
		const first = journal();
		await first.load();
		const mine = crypto.randomUUID();
		await first.claim(mine);
		expect(first.origin(mine)).toBe("broski");
		expect(first.origin(crypto.randomUUID())).toBe("external");
		const second = journal();
		await second.load();
		expect(second.origin(mine)).toBe("broski");
	});

	test("when the bridge's host of a session last ended survives a restart; the newest end wins", async () => {
		const first = journal();
		await first.load();
		const session = crypto.randomUUID();
		expect(first.releasedAt(session)).toBeUndefined();
		await first.noteReleased(session, 1_000);
		await first.noteReleased(session, 2_000);
		expect(first.releasedAt(session)).toBe(2_000);
		const second = journal();
		await second.load();
		expect(second.releasedAt(session)).toBe(2_000);
		expect(second.origin(session)).toBe("external");
	});

	test("a prompt has a record exactly when it was noted, with its image names in order", async () => {
		const first = journal();
		await first.load();
		const session = crypto.randomUUID();
		const sent = crypto.randomUUID();
		await first.notePrompt(session, sent, { imageNames: ["a.png", undefined, "c.png"] });
		expect(first.prompt(session, sent)).toEqual({ imageNames: ["a.png", undefined, "c.png"] });
		expect(first.prompt(session, crypto.randomUUID())).toBeUndefined();
		expect(first.prompt(crypto.randomUUID(), sent)).toBeUndefined();
		const second = journal();
		await second.load();
		expect(second.prompt(session, sent)).toEqual({ imageNames: ["a.png", undefined, "c.png"] });
	});

	test("a damaged line is skipped and the rest is kept; a missing file is an empty journal", async () => {
		const ownership = journal();
		await ownership.load();
		const mine = crypto.randomUUID();
		await ownership.claim(mine);
		appendFileSync(join(root, "state", "owned.jsonl"), 'not json\n{"k":"s"}\n{"k":"x","i":"y"}\n');
		const again = journal();
		await again.load();
		expect(again.origin(mine)).toBe("broski");
		const none = journal(join(root, "nowhere"));
		await none.load();
		expect(none.origin(mine)).toBe("external");
	});

	test("a long name is cut and a list of names is bounded", async () => {
		const ownership = journal();
		await ownership.load();
		const session = crypto.randomUUID();
		const sent = crypto.randomUUID();
		await ownership.notePrompt(session, sent, { imageNames: Array.from({ length: 150 }, () => "n".repeat(900)) });
		const record = ownership.prompt(session, sent);
		expect(record?.imageNames).toHaveLength(100);
		expect(record?.imageNames[0]?.length).toBe(256);
	});

	test("the file stays private to the user", async () => {
		const ownership = journal();
		await ownership.load();
		await ownership.claim(crypto.randomUUID());
		expect(statSync(join(root, "state", "owned.jsonl")).mode & 0o777).toBe(0o600);
		expect(statSync(join(root, "state")).mode & 0o777).toBe(0o700);
	});

	test("a journal far past its bounds is read from its tail and rewritten within them", async () => {
		mkdirSync(join(root, "state"), { recursive: true });
		const lines: string[] = [];
		const ids: string[] = [];
		for (let n = 0; n < 190_000; n++) {
			const id = crypto.randomUUID();
			ids.push(id);
			lines.push(JSON.stringify({ k: "s", i: id }));
		}
		writeFileSync(join(root, "state", "owned.jsonl"), `${lines.join("\n")}\n`);
		const ownership = journal();
		await ownership.load();
		expect(ownership.origin(ids[0] ?? "")).toBe("external");
		expect(ownership.origin(ids.at(-1) ?? "")).toBe("broski");
		const kept = readFileSync(join(root, "state", "owned.jsonl"), "utf8")
			.split("\n")
			.filter(Boolean);
		expect(kept.length).toBeLessThanOrEqual(20_000);
		const survivors = ids.filter((id) => ownership.origin(id) === "broski").length;
		expect(survivors).toBe(20_000);
	});
});
