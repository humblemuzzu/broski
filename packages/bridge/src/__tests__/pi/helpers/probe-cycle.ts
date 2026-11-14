/**
 * Run by `runProbe`, not by `bun test`: a Pi world reading a session file whose entries are each
 * other's parent. Prints what the adapter answered as one JSON line, then exits.
 */

import { PiWorld } from "./pi-world";
import { messageEntry, writeSessionFile } from "./session-files";

const world = await PiWorld.create({ catalog: { emit: () => {} } });
const id = "parent-cycle";
writeSessionFile(world.sessionsRoot, { id, cwd: world.env.cwd, version: 3 }, [
	messageEntry("a", "b", "user", "first of the loop"),
	messageEntry("b", "a", "assistant", "second of the loop"),
	messageEntry("c", "c", "user", "its own parent"),
]);
const ref = { backend: "pi", sessionId: id } as const;
const read = await world.backend.readTranscript(ref, { limit: 200 });
const found = await world.backend.getSession(ref);
const listed = await world.backend.listSessions({ cwd: world.env.cwd }, { limit: 50 });
const answer = {
	transcript: read.status === "accepted" ? read.page.items.map((item) => item.id) : read.rejection.code,
	session: found.status,
	listed: listed.status === "accepted" ? listed.page.items.map((row) => row.session.sessionId) : listed.rejection.code,
};
await world.backend.dispose();
world.dispose();
console.log(JSON.stringify(answer));
process.exit(0);
