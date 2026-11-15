/**
 * One session through the whole bridge, as a phone drives it over the broski-link socket: the real core, the real Pi
 * adapter, the real `pi` against the scripted endpoint. Create, prompt, stream, a permission ask, allow, the run's end,
 * the listing, the transcript, a fork and a delete.
 */

import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendFactory } from "../../contract";
import { E2E_TEST_TIMEOUT_MS, startBridge } from "../e2e/harness";
import { connectPhone } from "../helpers/link-contract-client";
import { PiWorld } from "./helpers/pi-world";
import { readReadme, say } from "./helpers/scenarios";
import { findSessionFile } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);
useWatchdog();

let cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	for (const step of cleanup.reverse()) await step();
	cleanup = [];
});

test("create, prompt, stream, ask, allow, finish, list, read, fork and delete a Pi session from a phone", async () => {
	let world: PiWorld | undefined;
	const factory: BackendFactory = async (host) => {
		world = await PiWorld.create(host);
		return world.backend;
	};
	const root = realpathSync(mkdtempSync(join(tmpdir(), "broski-pi-smoke-")));
	const socketPath = join(root, "link.sock");
	const bridge = await startBridge({
		linkSocket: socketPath,
		contract: { backends: [["pi", factory]], journalDirectory: join(root, "core") },
	});
	cleanup.push(
		() => rmSync(root, { recursive: true, force: true }),
		() => world?.dispose(),
		async () => {
			await bridge.stop();
		},
	);
	const phone = await connectPhone(socketPath, "phone");
	cleanup.push(() => phone.socket.close());
	await phone.hello();
	while (!(await phone.ok("backends.list", {})).backends.some((backend) => backend.id === "pi")) await Bun.sleep(25);
	if (!world) throw new Error("Pi did not start");
	const { cwd } = world.env;

	const created = await phone.ok("session.create", {
		backend: "pi",
		options: { cwd, modes: [{ axis: "permissions", value: "ask" }] },
	});
	if (created.result.status !== "accepted") throw new Error(JSON.stringify(created.result));
	const { session } = created.result;
	world.router.script(session.sessionId, [readReadme(), say("The README says Project.")]);
	await phone.ok("session.attach", { session });

	const prompted = await phone.ok("prompt", {
		session,
		input: { clientRequestId: crypto.randomUUID(), mode: "start", text: "Read the README", attachments: [] },
	});
	expect(prompted.result).toEqual({ status: "accepted", disposition: "started" });

	const asked = await phone.waitForEvent(session, (e) => e.event.type === "interaction_requested", "the ask");
	if (asked.event.type !== "interaction_requested") throw new Error("not an ask");
	const { interaction } = asked.event;
	expect(interaction.request).toMatchObject({ kind: "tool_permission", input: { path: "README.md" } });
	const allow =
		interaction.request.kind === "tool_permission"
			? interaction.request.options.find((option) => option.effect === "allow" && option.scope === "once")
			: undefined;
	if (!allow) throw new Error("no allow-once option");
	const answered = await phone.ok("interaction.answer", {
		session,
		answer: { interactionId: interaction.id, reply: { kind: "tool_permission", optionId: allow.id, grantIds: [] } },
	});
	expect(answered.result).toEqual({ status: "accepted" });

	await phone.waitForEvent(session, (e) => e.event.type === "tool_finished", "the tool's end");
	await phone.waitForEvent(
		session,
		(e) => e.event.type === "block_finished" && e.event.text === "The README says Project.",
		"the streamed answer",
	);
	const finished = await phone.waitForEvent(session, (e) => e.event.type === "run_finished", "the run's end");
	expect(finished.event.type === "run_finished" && finished.event.outcome.kind).toBe("completed");

	const listed = await phone.ok("sessions.list", { backend: "pi", query: { cwd }, page: { limit: 20 } });
	expect(listed.result.status === "accepted" && listed.result.page.items.map((row) => row.session.sessionId)).toContain(
		session.sessionId,
	);

	const transcript = await phone.ok("transcript.read", { session, page: { limit: 50 } });
	if (transcript.result.status !== "accepted") throw new Error(JSON.stringify(transcript.result));
	const kinds = transcript.result.page.items.map((item) => item.kind);
	expect(kinds).toContain("user_message");
	expect(kinds).toContain("tool_call");
	expect(kinds).toContain("tool_result");

	const forked = await phone.ok("session.fork", { session });
	if (forked.result.status !== "accepted") throw new Error(JSON.stringify(forked.result));
	const fork = forked.result.session;
	expect(fork.sessionId).not.toBe(session.sessionId);
	expect(findSessionFile(world.sessionsRoot, fork.sessionId)).toBeDefined();

	await phone.ok("session.detach", { session });
	const file = findSessionFile(world.sessionsRoot, session.sessionId);
	const deleted = await phone.ok("session.delete", { session });
	expect(deleted.result).toEqual({ status: "accepted" });
	expect(file !== undefined && existsSync(file)).toBe(false);
	expect(world.trash.trashed().length).toBe(1);
});
