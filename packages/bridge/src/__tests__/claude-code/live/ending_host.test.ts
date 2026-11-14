/**
 * Adapter README D25's window: a host ends (idle grace, `end`) and its own last write is noted only once its process is
 * gone, up to `PROCESS_END_DEADLINE_MS` later. Until then the session still counts as hosted, so an open in that window
 * is not taken for a terminal writing the file.
 */

import { afterEach, expect, test } from "bun:test";
import { FakeQuery } from "../helpers/fake-query";
import { flush, promptOf, tempProject } from "./helpers/fake-host";
import { idle, init, running } from "./helpers/frames";
import { fakeRig } from "./helpers/rig";

const projects: { remove: () => void }[] = [];

afterEach(() => {
	for (const project of projects.splice(0)) project.remove();
});

test("a host still ending counts as hosted until its own last write is noted", async () => {
	const query = new FakeQuery();
	const rig = fakeRig([query]);
	const project = tempProject();
	projects.push(project);
	const live = await rig.openNew(project.dir);
	const id = live.ref.sessionId;
	await live.control.prompt(promptOf("hello"));
	query.push(running(), init(), idle());
	await flush();
	let release: () => void = () => undefined;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const note = rig.ownership.noteOwnWrite;
	rig.ownership.noteOwnWrite = async (sessionId, at) => {
		await gate;
		await note(sessionId, at);
	};
	await live.close();
	const ending = rig.live.end(id);
	await flush();
	expect(rig.live.isHosted(id)).toBe(true);
	release();
	await ending;
	expect(rig.ownership.released.has(id)).toBe(true);
	expect(rig.live.isHosted(id)).toBe(false);
	await rig.dispose();
});
