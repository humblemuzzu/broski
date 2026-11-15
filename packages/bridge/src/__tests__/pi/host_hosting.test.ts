/**
 * Hosting a session: what a new session asks for is checked before anything is written or built, a new session is on
 * disk from its creation, an untrusted project's extensions are not loaded, no package is installed, the permissions
 * mode survives the host, and a hosted session is renamed and deleted through its host.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ProjectTrustStore, SessionManager } from "@earendil-works/pi-coding-agent";
import type { CatalogEvent, NewSessionOptions, SessionRef, SessionSummary } from "../../contract";
import { MODELS, wireIdOf } from "./helpers/pi-world";
import { conversation, sessionEntries, userTexts, writeSessionFile } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig, until } from "./host_rig";

useWatchdog();

let t: HostRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

function updatesOf(catalog: readonly CatalogEvent[]): SessionSummary[] {
	return catalog.flatMap((event) => (event.type === "session_updated" ? [event.summary] : []));
}

describe("a new session is checked before a runtime is built", () => {
	const refused: [string, Partial<NewSessionOptions>, string][] = [
		["a model nobody lists", { modelId: "scripted/nope" }, "not_found"],
		["a thinking level the model lacks", { modelId: wireIdOf(MODELS.plain), thinking: "high" }, "invalid_input"],
		["a thinking level the default model lacks", { thinking: "no-such-level" }, "invalid_input"],
		["a mode nobody offers", { modes: [{ axis: "permissions", value: "sometimes" }] }, "invalid_input"],
		["a directory that does not exist", { cwd: "/definitely/not/here" }, "invalid_input"],
	];

	test.each(refused)("%s is refused, and no runtime is left behind", async (_what, options, code) => {
		t = await HostRig.create();
		const opened = await t.rig.rig.backend.open(
			{ kind: "new", options: { cwd: t.rig.cwd, ...options } },
			{ emit: () => {} },
		);

		expect(opened).toMatchObject({ status: "rejected", rejection: { code } });
		await t.rig.driver.quiesce();
		expect(t.router.liveRuntimes()).toBe(0);
		expect(readdirSync(t.rig.world.sessionsRoot, { recursive: true })).toEqual([]);
	});

	test("a thinking level with no model named is checked against the model Pi picks, and applied", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew({ thinking: "high" });
		expect(live.initial.thinking).toBe("high");
		expect(live.initial.modelId).toBe(wireIdOf(MODELS.reasoner));
	});

	test("a model and a thinking level that fit start the session on them", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew({ modelId: wireIdOf(MODELS.noOff), thinking: "low" });
		expect(live.initial).toMatchObject({ modelId: wireIdOf(MODELS.noOff), thinking: "low" });
	});
});

describe("a new session nobody has prompted", () => {
	test("is on disk from its creation, listed, announced, and deleted through the trash like any other", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		const path = t.rig.fileOf(live.ref);
		expect(sessionEntries(path).map((entry) => entry.type === "custom" && entry.customType)).toContain("broski.origin");

		const listed = await t.rig.rig.backend.listSessions({ cwd: t.rig.cwd }, { limit: 50 });
		expect(listed.status === "accepted" && listed.page.items.map((item) => item.session.sessionId)).toContain(
			live.ref.sessionId,
		);
		expect(updatesOf(t.rig.catalog.items).some((summary) => summary.session.sessionId === live.ref.sessionId)).toBe(
			true,
		);

		const deleted = await t.rig.rig.backend.delete?.(live.ref);
		expect(deleted?.status).toBe("accepted");
		expect(t.rig.catalog.items).toContainEqual({ type: "session_removed", session: live.ref });
		expect(t.rig.world.trash.calls()).toEqual([path]);
		await until(() => t?.router.liveRuntimes() === 0, "the host ends");
	});

	test("outlives its host and a restart: found, opened again, prompted, and Pi appends to the file it began", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		const path = t.rig.fileOf(live.ref);
		await live.close();
		await until(() => t?.router.liveRuntimes() === 0, "the host ends");
		expect(t.rig.catalog.items.some((event) => event.type === "session_removed")).toBe(false);
		expect((await t.rig.rig.backend.getSession(live.ref)).status).toBe("accepted");

		await t.rig.rig.restart();
		const reopened = await t.rig.rig.open(live.ref);
		expect(reopened.control).toBeDefined();
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		expect((await reopened.run("first words")).outcome.kind).toBe("completed");
		expect(reopened.events().filter((event) => event.type === "error")).toEqual([]);

		const lines = readFileSync(path, "utf8").trimEnd().split("\n");
		expect(lines.filter((line) => line.includes('"type":"session"'))).toHaveLength(1);
		const manager = SessionManager.open(path, dirname(path));
		expect(manager.getSessionId()).toBe(live.ref.sessionId);
		const roles = manager.buildSessionContext().messages.map((message) => message.role);
		expect(roles.filter((role) => role === "user" || role === "assistant")).toEqual(["user", "assistant"]);
		expect(userTexts(path)).toEqual(["first words"]);
	});
});

describe("project trust", () => {
	function writeProjectExtension(cwd: string): void {
		const dir = join(cwd, ".pi", "extensions");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "evil.ts"),
			'export default function (pi) { pi.registerCommand("evil", { description: "x", handler: async () => {} }); }\n',
		);
	}

	/** The commands the session's own `pi` runs. */
	async function commandNames(rig: HostRig, ref: SessionRef): Promise<string[]> {
		const answer = await rig.host(ref).commands();
		if (!answer.ok) throw new Error(answer.error);
		return answer.data.map((command) => command.name);
	}

	test("a project's own extensions are not loaded until the user trusted it", async () => {
		t = await HostRig.create();
		writeProjectExtension(t.rig.cwd);
		const untrusted = await t.rig.rig.openNew();
		expect(await commandNames(t, untrusted.ref)).not.toContain("evil");
		await untrusted.close();

		new ProjectTrustStore(t.rig.world.env.agentDir).set(t.rig.cwd, true);
		const trusted = await t.rig.rig.openNew();
		expect(await commandNames(t, trusted.ref)).toContain("evil");
	});

	test("a project the user distrusted stays closed to its extensions", async () => {
		t = await HostRig.create();
		writeProjectExtension(t.rig.cwd);
		new ProjectTrustStore(t.rig.world.env.agentDir).set(t.rig.cwd, false);
		const live = await t.rig.rig.openNew();
		expect(await commandNames(t, live.ref)).not.toContain("evil");
	});
});

describe("package installs", () => {
	// In RPC mode Pi reports no missing package (pi-coding-agent 1.5.2 prints nothing for one), so it cannot be named.
	test("a configured package that is missing is never installed by the open", async () => {
		t = await HostRig.create({ settings: { packages: ["npm:not-on-this-machine"] } });
		const bin = join(t.rig.world.env.root, "npm-bin");
		const calls = join(t.rig.world.env.root, "npm-calls.log");
		mkdirSync(bin);
		writeFileSync(join(bin, "npm"), `#!/bin/sh\necho "$@" >> '${calls}'\necho ${t.rig.world.env.root}/npm-root\n`);
		chmodSync(join(bin, "npm"), 0o755);
		process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
		await t.rig.rig.restart();

		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		expect((await live.run("go")).outcome.kind).toBe("completed");
		const npmCalls = existsSync(calls) ? readFileSync(calls, "utf8").split("\n") : [];
		expect(npmCalls.filter((line) => /install/.test(line))).toEqual([]);
	});
});

describe("the permissions mode", () => {
	test("is written to the session and still on when the session is hosted again", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		await live.run("first");
		expect((await live.control.setMode("permissions", "ask")).status).toBe("accepted");
		await live.close();
		await until(() => t?.router.liveRuntimes() === 0, "the idle host ends");

		const again = await t.rig.rig.open(live.ref);
		expect(again.initial.modes).toEqual([{ axis: "permissions", value: "ask" }]);
		const entries = sessionEntries(t.rig.fileOf(live.ref));
		expect(
			entries.filter((entry) => entry.type === "custom" && entry.customType === "broski.permissions"),
		).toHaveLength(1);
	});

	test("a mode set to the value it has is accepted, announced, and written once", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		const mark = live.recorder.items.length;
		expect((await live.control.setMode("permissions", "off")).status).toBe("accepted");
		await live.waitFor("mode_changed", (event) => event.value === "off", mark);
	});
});

describe("a hosted session", () => {
	test("is renamed through its host: the title is a user title in the catalog and a session_info entry in the file", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		await live.run("hello");

		const renamed = await t.rig.rig.backend.rename?.(live.ref, "A better name");

		expect(renamed?.status).toBe("accepted");
		const latest = updatesOf(t.rig.catalog.items).findLast(
			(summary) => summary.session.sessionId === live.ref.sessionId,
		);
		expect(latest?.title).toEqual({ text: "A better name", source: "user" });
		expect(sessionEntries(t.rig.fileOf(live.ref)).some((entry) => entry.type === "session_info")).toBe(true);
	});

	test("is busy to delete while it runs, and deleted once it is idle: its views then answer closed", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "hold" });
		await live.prompt("go");
		await live.waitFor("tool_started", (event) => event.name === "driver_hold");

		const refused = await t.rig.rig.backend.delete?.(live.ref);
		expect(refused).toMatchObject({ status: "rejected", rejection: { code: "busy" } });

		await t.rig.driver.release(live.ref);
		await live.waitFor("run_finished");
		const deleted = await t.rig.rig.backend.delete?.(live.ref);
		expect(deleted?.status).toBe("accepted");
		expect(await live.prompt("too late")).toMatchObject({ status: "rejected", rejection: { code: "closed" } });
		await until(() => t?.router.liveRuntimes() === 0, "the host ends");
	});
});

describe("a session another client made", () => {
	test("opens with the permissions mode off and no control, and is never written to", async () => {
		t = await HostRig.create();
		const id = "terminal-session-2";
		writeSessionFile(t.rig.world.sessionsRoot, { id, cwd: t.rig.cwd, version: 3 }, conversation(["hello", "hi"]));

		const opened = await t.rig.rig.open({ backend: "pi", sessionId: id });
		expect(opened.session.control).toBeUndefined();
		expect(opened.initial.modes).toEqual([{ axis: "permissions", value: "off" }]);
		expect(t.router.starts(id)).toBe(0);
		expect(opened.recorder.items).toEqual([]);
	});
});

describe("the commands of a directory a session is open in", () => {
	test("are that session's: no other pi is started to list them", async () => {
		t = await HostRig.create();
		await t.rig.rig.openNew();
		const probes = t.rig.world.probes();
		const listed = await t.rig.rig.backend.listCommands({ cwd: t.rig.cwd });
		expect(listed.status === "accepted" && listed.commands.map((command) => command.id)).toContain("ext:kick");
		expect(t.rig.world.probes()).toBe(probes);
	});
});
