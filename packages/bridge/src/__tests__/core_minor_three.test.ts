/**
 * What protocol 1.3 added, as the core serves it: the `compaction.cancel` and `retry.cancel` requests, the
 * `SessionCapabilities` fields that announce them, and the ops `session_settings`, `session_tools` and `system_prompt`
 * (a client of an older minor is told of none of these, and sends none).
 */

import { describe, expect, test } from "bun:test";
import { type AgentBackend, SESSION_CONTROL_OP_KINDS, SessionCapabilities } from "../contract";
import { quiesce, RIG_CWD, startCoreRig } from "./helpers/core-rig";

const MINOR_TWO = { major: 1, minor: 2 } as const;
const NEW_OPS = SESSION_CONTROL_OP_KINDS;

const withoutCancels = (backend: AgentBackend): AgentBackend => ({
	...backend,
	open: async (target, sink) => {
		const opened = await backend.open(target, sink);
		if (opened.status === "rejected" || !opened.session.control) return opened;
		const { cancelCompaction: _compaction, cancelRetry: _retry, ...control } = opened.session.control;
		return { ...opened, session: { ...opened.session, control } };
	},
});

describe("the capabilities of a session", () => {
	test("name the cancels to a client of this minor, and are what an older client's strict parse accepts", async () => {
		const rig = await startCoreRig();
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const current = await (await rig.client("current")).ok("session.attach", { session });
		expect(current.capabilities).toMatchObject({ cancelCompaction: true, cancelRetry: true });

		const older = await (await rig.client("older", MINOR_TWO)).ok("session.attach", { session });
		expect(Object.keys(older.capabilities).sort()).toEqual(["cancelQueued", "compact", "controllable"]);
		expect(SessionCapabilities.safeParse(older.capabilities).success).toBe(true);
	});

	test("say a backend that cannot cancel on its own cannot", async () => {
		const rig = await startCoreRig({ adapt: withoutCancels });
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const phone = await rig.client("phone");
		const attached = await phone.ok("session.attach", { session });
		expect(attached.capabilities).toMatchObject({ cancelCompaction: false, cancelRetry: false });
		const answers = [
			(await phone.ok("compaction.cancel", { session })).result,
			(await phone.ok("retry.cancel", { session })).result,
		];
		expect(answers.map((result) => result.status === "rejected" && result.rejection.code)).toEqual([
			"unsupported",
			"unsupported",
		]);
	});
});

describe("the ops a client is told of", () => {
	const ops = async (protocol?: typeof MINOR_TWO) => {
		const rig = await startCoreRig({
			adapt: (backend) => ({
				...backend,
				traits: { ...backend.traits, backendOps: [...backend.traits.backendOps, "take_over", ...NEW_OPS] },
			}),
		});
		const listed = await (await rig.client("app", protocol)).ok("backends.list", {});
		return listed.backends.flatMap((backend) => backend.capabilities.backendOps);
	};

	test("are all listed to a client of this minor", async () => {
		expect(await ops()).toEqual(expect.arrayContaining(["take_over", ...NEW_OPS]));
	});

	test("are listed to a client of minor 2 only as far as its minor goes", async () => {
		const listed = await ops(MINOR_TWO);
		expect(listed).toContain("take_over");
		for (const op of NEW_OPS) expect(listed).not.toContain(op);
	});
});

describe("cancelling a compaction or a retry", () => {
	test("needs an attached session", async () => {
		const rig = await startCoreRig();
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const phone = await rig.client("phone");
		const answers = [
			await phone.request("compaction.cancel", { session }),
			await phone.request("retry.cancel", { session }),
		];
		expect(answers.map((answer) => answer.type === "error" && answer.error.code)).toEqual([
			"not_attached",
			"not_attached",
		]);
	});

	test("ends a compaction on its own: it finishes aborted for every viewer", async () => {
		const rig = await startCoreRig();
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const phone = await rig.client("phone");
		const watcher = await rig.client("watcher");
		await phone.ok("session.attach", { session });
		await watcher.ok("session.attach", { session });
		rig.fake.fake.slowCompaction(session);
		expect((await phone.ok("compact", { session })).result.status).toBe("accepted");
		await quiesce();

		expect((await phone.ok("compaction.cancel", { session })).result.status).toBe("accepted");
		await quiesce();
		for (const viewer of [phone, watcher]) {
			expect(viewer.events(session).map((event) => event.type)).toEqual(["compaction_started", "compaction_finished"]);
			expect(viewer.events(session).at(-1)).toEqual({ type: "compaction_finished", outcome: { kind: "aborted" } });
		}
	});

	test("ends the wait before a retry on its own: the retry finishes unsuccessfully and the run ends in error", async () => {
		const rig = await startCoreRig();
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const phone = await rig.client("phone");
		await phone.ok("session.attach", { session });
		rig.fake.fake.script(session, [{ kind: "retry_wait" }, { kind: "text", text: "Recovered." }]);
		await phone.ok("prompt", {
			session,
			input: { clientRequestId: crypto.randomUUID(), mode: "start", text: "go", attachments: [], mentions: [] },
		});
		await quiesce();
		expect(phone.events(session).map((event) => event.type)).toContain("retry_scheduled");

		expect((await phone.ok("retry.cancel", { session })).result.status).toBe("accepted");
		await quiesce();
		const types = phone.events(session).map((event) => event.type);
		expect(types.slice(-2)).toEqual(["retry_finished", "run_finished"]);
		expect(phone.events(session).find((event) => event.type === "retry_finished")).toEqual({
			type: "retry_finished",
			succeeded: false,
		});
		expect(phone.events(session).at(-1)).toMatchObject({ outcome: { kind: "error" } });
	});
});
