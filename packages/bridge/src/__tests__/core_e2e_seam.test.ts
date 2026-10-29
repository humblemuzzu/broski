/**
 * The seam between the core and the running bridge, end to end over the broski-link socket: the
 * hooks in the old connection layer, the rate limit, the old guards beside the contract, and the
 * backends starting after the bridge listens.
 */

import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendFactory } from "../contract";
import { createFakeBackend } from "../contract/testing/fake-backend";
import { DEFAULT_IDLE_CLOSE_MS } from "../core/keep-open";
import { E2E_TEST_TIMEOUT_MS, setupTestEnv, startBridge } from "./e2e/harness";
import { removeRoot, startCoreBridge } from "./helpers/core-bridge";
import { ManualClock } from "./helpers/core-rig";
import { connectPhone, type LinkContractClient, messageRequestId } from "./helpers/link-contract-client";
import type { LinkFrame } from "./link/unix-ws";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const env = setupTestEnv();
const roots: string[] = [];

afterAll(() => {
	for (const root of roots) removeRoot(root);
	env.restore();
});

function contractAnswers(phone: LinkContractClient, requestId: string): LinkFrame[] {
	return phone.socket.frames().filter((frame) => frame.type === "contract" && messageRequestId(frame) === requestId);
}

describe("the seam into the running bridge", () => {
	test("a phone whose socket closes lets its sessions go, and they close once idle", async () => {
		const rig = await startCoreBridge();
		roots.push(rig.root);
		try {
			const phone = await rig.phone("phone");
			const session = rig.fake.fake.seed({ cwd: rig.cwd });
			await phone.ok("session.attach", { session });
			expect(rig.clock.pending()).toBe(0);
			phone.socket.close();
			await rig.clock.whenPending(1);
			rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
			expect(rig.opens.closed).toEqual([session.sessionId]);
		} finally {
			await rig.stop();
		}
	});

	test("stopping the bridge disposes the backends", async () => {
		const rig = await startCoreBridge();
		roots.push(rig.root);
		await rig.phone("phone");
		expect(rig.disposals()).toBe(0);
		await rig.stop();
		expect(rig.disposals()).toBe(1);
	});

	test("a contract frame holding keys the old protocol refuses is the core's to judge, and gets its one answer", async () => {
		const rig = await startCoreBridge();
		roots.push(rig.root);
		try {
			const phone = await rig.phone("phone");
			const session = rig.fake.fake.seed({ cwd: rig.cwd });
			phone.sendRaw({
				type: "backend.call",
				requestId: "poison",
				call: { backend: "pi", op: { kind: "x", constructor: 1 } },
			});
			const reply = {
				kind: "tool_permission",
				optionId: "o",
				grantIds: [],
				editedInput: { constructor: { prototype: 1 } },
			};
			phone.sendRaw({ type: "interaction.answer", requestId: "legal", session, answer: { interactionId: "i", reply } });
			const [refused] = await Promise.all([
				phone.waitForMessage((message) => "requestId" in message && message.requestId === "poison", "poison"),
				phone.waitForMessage((message) => "requestId" in message && message.requestId === "legal", "legal"),
			]);
			expect(refused).toMatchObject({ type: "error", error: { code: "invalid_message" } });
			expect(contractAnswers(phone, "legal")).toMatchObject([{ message: { error: { code: "not_attached" } } }]);
			phone.socket.send({ type: "abort", requestId: "old", constructor: 1 });
			const old = await phone.socket.waitFor("error");
			expect(old).toMatchObject({ message: "Invalid JSON payload" });
		} finally {
			await rig.stop();
		}
	});

	test("contract frames past the connection's rate limit are each answered rate_limited by the core", async () => {
		const previous = process.env.BROSKI_RATE_LIMIT_BURST;
		process.env.BROSKI_RATE_LIMIT_BURST = "10";
		const rig = await startCoreBridge().finally(() => {
			if (previous === undefined) delete process.env.BROSKI_RATE_LIMIT_BURST;
			else process.env.BROSKI_RATE_LIMIT_BURST = previous;
		});
		roots.push(rig.root);
		try {
			const phone = await connectPhone(rig.socketPath, "flood");
			const ids = Array.from({ length: 40 }, (_, index) => `flood-${index}`);
			for (const requestId of ids)
				phone.sendRaw({
					type: "hello",
					requestId,
					protocol: { major: 1, minor: 0 },
					client: { name: "f", version: "1" },
				});
			await phone.waitForMessage((message) => "requestId" in message && message.requestId === ids.at(-1), "the last");
			const answers = ids.map((requestId) => contractAnswers(phone, requestId));
			expect(answers.every((frames) => frames.length === 1)).toBe(true);
			const codes = answers.map(([frame]) => {
				const message = frame?.message;
				return typeof message === "object" && message !== null && "type" in message ? message.type : undefined;
			});
			expect(codes.filter((type) => type === "hello.result").length).toBeGreaterThan(0);
			expect(codes.filter((type) => type === "error").length).toBeGreaterThan(0);
			expect(
				phone
					.messages()
					.filter((message) => message.type === "error")
					.every((message) => message.error.code === "rate_limited"),
			).toBe(true);
			expect(phone.socket.frames().filter((frame) => frame.message === "RATE_LIMITED")).toEqual([]);
			phone.socket.send({ type: "an_old_request", requestId: "old" });
			await phone.socket.waitForWhere((frame) => frame.message === "RATE_LIMITED", "the old protocol's refusal");
		} finally {
			await rig.stop();
		}
	});

	test("a contract frame larger than the contract's message bound is refused with its requestId", async () => {
		const rig = await startCoreBridge();
		roots.push(rig.root);
		try {
			const phone = await rig.phone("phone");
			const session = rig.fake.fake.seed({ cwd: rig.cwd });
			const text = "x".repeat(9 * 1024 * 1024);
			const input = { clientRequestId: crypto.randomUUID(), mode: "start", text, attachments: [], mentions: [] };
			phone.sendRaw({ type: "prompt", requestId: "huge", session, input });
			const refused = await phone.waitForMessage(
				(message) => "requestId" in message && message.requestId === "huge",
				"the refusal",
			);
			expect(refused).toMatchObject({
				type: "error",
				error: { code: "invalid_message", message: expect.stringContaining("bytes") },
			});
		} finally {
			await rig.stop();
		}
	});

	test("the bridge listens before its backends have started, and a phone hears when one lands", async () => {
		const root = mkdtempSync(join(realpathSync(tmpdir()), "broski-core-"));
		roots.push(root);
		const gate = Promise.withResolvers<void>();
		const factory: BackendFactory = async (host) => {
			await gate.promise;
			return createFakeBackend(host);
		};
		const socketPath = join(root, "link.sock");
		const bridge = await startBridge({
			linkSocket: socketPath,
			contract: {
				backends: [["pi", factory]],
				clock: new ManualClock(),
				promptJournalPath: join(root, "prompts.jsonl"),
			},
		});
		try {
			const phone = await connectPhone(socketPath, "early");
			await phone.hello();
			expect((await phone.ok("backends.list", {})).backends).toEqual([]);
			const listing = phone.request("sessions.list", { backend: "pi", query: { archived: false }, page: { limit: 5 } });
			gate.resolve();
			expect(await listing).toMatchObject({ type: "sessions.list.result", result: { status: "accepted" } });
			const news = await phone.waitForMessage((message) => message.type === "catalog", "the backend's arrival");
			expect(news).toMatchObject({ type: "catalog", backend: "pi", event: { type: "status_changed" } });
		} finally {
			await bridge.stop();
		}
	});
});
