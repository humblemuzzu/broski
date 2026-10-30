/**
 * What a session open shares with the rest of the process: `PI_OFFLINE` (`withoutPackageInstalls`),
 * the one `ModelRuntime` every open refreshes, and the core's prompt ledger above the host.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { PromptLedger } from "../../core/prompt-ledger";
import { FAUX_MODEL_IDS } from "./helpers/faux-models";
import { countOf, userMessages } from "./helpers/live-steps";
import { say, toolUse } from "./helpers/scenarios";
import { userTexts } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig, pause, until } from "./host_rig";

useWatchdog();

let t: HostRig | undefined;

/** A git source never cloned: Pi checks for it on disk only, so no `git` or `npm` runs (`package-manager.ts:1336-1340`). */
const MISSING_PACKAGE = "git:github.com/example/never-installed";

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

describe("PI_OFFLINE while another session opens", () => {
	test("is left as the process has it when nothing is missing, so a tool running in another session can fetch fd or rg", async () => {
		const before = process.env.PI_OFFLINE;
		t = await HostRig.create();
		const toolGate = t.gate("toolGate");
		const running = await t.rig.rig.openNew();
		t.router.script(running.ref.sessionId, [toolUse(fauxToolCall("ignore_abort", {})), say("done")]);
		await running.prompt("go");
		await toolGate.entered.promise;

		const loadGate = t.gate("loadGate");
		const opening = t.rig.rig.openNew();
		await loadGate.entered.promise;
		expect(process.env.PI_OFFLINE).toBe(before);

		toolGate.open();
		await running.waitFor("run_finished");
		expect(t.state.toolSawOffline).toEqual([before]);

		loadGate.open();
		await opening;
		expect(t.state.offlineSeen.at(-1)).toBe(before);
	});

	test("is on while a load skips a missing package, and back to the process's own value after, also when a load fails", async () => {
		const before = process.env.PI_OFFLINE;
		t = await HostRig.create({ settings: { packages: [MISSING_PACKAGE] } });
		const refused = await t.rig.rig.backend.open(
			{ kind: "new", options: { cwd: t.rig.cwd, modelId: "faux/nope" } },
			{ emit: () => {} },
		);
		expect(refused.status).toBe("rejected");
		const live = await t.rig.rig.openNew();
		expect(t.state.offlineSeen.at(-1)).toBe("1");
		expect(process.env.PI_OFFLINE).toBe(before);
		expect(existsSync(join(t.rig.world.env.agentDir, "git"))).toBe(false);
		const notice = await live.waitFor("notice", (event) => event.text.includes(MISSING_PACKAGE));
		expect(notice.level).toBe("warning");
	});
});

describe("two opens at once share one ModelRuntime", () => {
	test("their refreshes overlap, and Pi's sequence numbers leave one consistent catalogue", async () => {
		t = await HostRig.create();
		const original = ModelRuntime.prototype.refresh;
		let inFlight = 0;
		let overlap = 0;
		const spy = spyOn(ModelRuntime.prototype, "refresh").mockImplementation(async function (
			this: ModelRuntime,
			...args
		) {
			inFlight++;
			overlap = Math.max(overlap, inFlight);
			try {
				const result = await original.apply(this, args);
				await pause(40);
				return result;
			} finally {
				inFlight--;
			}
		});
		try {
			const [first, second, listed] = await Promise.all([
				t.rig.rig.openNew(),
				t.rig.rig.openNew({ modelId: `faux/${FAUX_MODEL_IDS.plain}` }),
				t.rig.rig.backend.listModels(t.rig.cwd),
			]);
			expect(overlap).toBeGreaterThanOrEqual(2);
			expect(listed.status === "accepted" && listed.models).toHaveLength(Object.keys(FAUX_MODEL_IDS).length);

			await t.rig.rig.arrange(first.ref, { kind: "reply" });
			await t.rig.rig.arrange(second.ref, { kind: "reply" });
			const [a, b] = await Promise.all([first.run("one"), second.run("two")]);
			expect([a.outcome.kind, b.outcome.kind]).toEqual(["completed", "completed"]);
			const after = await t.rig.rig.backend.listModels(t.rig.cwd);
			expect(after).toEqual(listed);
		} finally {
			spy.mockRestore();
		}
	});
});

describe("a repeated prompt after the session was closed and hosted again", () => {
	test("never reaches the host: the core's ledger answers it with the first result", async () => {
		t = await HostRig.create();
		const ledger = new PromptLedger(undefined);
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		const input = {
			clientRequestId: crypto.randomUUID(),
			mode: "start" as const,
			text: "once only",
			attachments: [],
			mentions: [],
		};
		let sent = 0;
		const first = await ledger.submit(live.ref, input, (i) => {
			sent++;
			return live.control.prompt(i);
		});
		await live.waitFor("run_finished");
		await live.close();
		await until(() => t?.bus.liveRuntimes() === 0, "the host ends");

		const reopened = await t.rig.rig.open(live.ref);
		const again = await ledger.submit(live.ref, input, (i) => {
			sent++;
			return reopened.control.prompt(i);
		});

		expect(again).toEqual(first);
		expect(sent).toBe(1);
		await t.rig.driver.quiesce();
		expect(countOf(reopened, "run_started")).toBe(0);
		expect(userMessages(reopened)).toEqual([]);
		expect(userTexts(t.rig.fileOf(live.ref))).toEqual(["once only"]);
	});
});
