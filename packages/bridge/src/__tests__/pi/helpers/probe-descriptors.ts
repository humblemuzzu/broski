/**
 * Run by `runProbe` under a low `ulimit -n`: a session listed, its file appended to, every descriptor then taken and
 * the session read, the descriptors given back and the session read again. Prints what each read answered.
 */

import { appendFileSync, closeSync, openSync } from "node:fs";
import { CatalogFeed } from "../../../backends/pi/catalog-feed";
import { createSessionStore } from "../../../backends/pi/store/session-store";
import { createPiTestEnv } from "./pi-test-env";
import { messageEntry, writeSessionFile } from "./session-files";

const env = createPiTestEnv();
const store = createSessionStore({
	agentDir: env.agentDir,
	catalog: new CatalogFeed({ emit: () => {} }),
	now: Date.now,
});
const nobody = { row: () => undefined };
const path = writeSessionFile(env.sessionDir, { id: "kept", cwd: env.cwd, version: 3 }, [
	messageEntry("a", null, "user", "hello"),
]);
const read = async () => {
	const found = await store.get("kept", nobody);
	return found.status === "accepted" ? found.summary.session.sessionId : found.rejection.code;
};
const before = await read();
appendFileSync(path, `${JSON.stringify(messageEntry("b", "a", "user", "again"))}\n`);
const held: number[] = [];
try {
	for (;;) held.push(openSync(env.agentDir, "r"));
} catch {}
const starved = await read();
for (const fd of held) closeSync(fd);
const after = await read();
store.dispose();
env.dispose();
console.log(JSON.stringify({ before, starved, after }));
process.exit(0);
