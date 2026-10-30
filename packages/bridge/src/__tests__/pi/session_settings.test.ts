/**
 * The `session_settings` op on a real Pi session: the four settings the terminal's `/settings` changes, where they are
 * saved, what a reopened session and a fresh `SettingsManager` read, and when a session cannot be changed from here.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { TerminalFeed } from "../../backends/pi/terminal/feed";
import { sessionCapabilities } from "../../contract";
import { LiveRig } from "./helpers/live-rig";
import { conversation, readEntries, writeSessionFile } from "./helpers/session-files";
import { callSettings, globalSettingsFile, refusal, settingsIn, settingValue } from "./helpers/session-ops";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

describe("reading the settings", () => {
	test("lists the four settings with the terminal's labels, as Pi defaults them", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const settings = settingsIn(await callSettings(t, live.ref));
		expect(settings.map((setting) => [setting.key, setting.label, setting.kind])).toEqual([
			["auto_compaction", "Auto-compact", "toggle"],
			["auto_retry", "Auto-retry", "toggle"],
			["steering_mode", "Steering mode", "choice"],
			["follow_up_mode", "Follow-up mode", "choice"],
		]);
		expect(settingValue(settings, "auto_compaction")).toBe(true);
		expect(settingValue(settings, "auto_retry")).toBe(true);
		expect(settingValue(settings, "steering_mode")).toBe("one-at-a-time");
		expect(settingValue(settings, "follow_up_mode")).toBe("one-at-a-time");
		const steering = settings.find((setting) => setting.key === "steering_mode");
		expect(steering?.kind === "choice" && steering.options.map((option) => option.value)).toEqual([
			"one-at-a-time",
			"all",
		]);
		expect(settings.every((setting) => setting.note === undefined)).toBe(true);
	});

	test("reads what the user's settings.json already says", async () => {
		t = await LiveRig.create({
			settings: { compaction: { enabled: false, keepRecentTokens: 1 }, steeringMode: "all" },
		});
		const live = await t.rig.openNew();
		const settings = settingsIn(await callSettings(t, live.ref));
		expect(settingValue(settings, "auto_compaction")).toBe(false);
		expect(settingValue(settings, "steering_mode")).toBe("all");
		expect(settingValue(settings, "auto_retry")).toBe(true);
	});
});

describe("changing a setting", () => {
	test("is the session's value at once, and is saved to the global settings.json beside what is there", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const before = globalSettingsFile(t);

		const toggled = settingsIn(
			await callSettings(t, live.ref, { kind: "toggle", key: "auto_compaction", enabled: false }),
		);
		expect(settingValue(toggled, "auto_compaction")).toBe(false);
		const retried = settingsIn(await callSettings(t, live.ref, { kind: "toggle", key: "auto_retry", enabled: false }));
		expect(settingValue(retried, "auto_retry")).toBe(false);
		const steered = settingsIn(await callSettings(t, live.ref, { kind: "choice", key: "steering_mode", value: "all" }));
		expect(settingValue(steered, "steering_mode")).toBe("all");
		const followed = settingsIn(
			await callSettings(t, live.ref, { kind: "choice", key: "follow_up_mode", value: "all" }),
		);
		expect(settingValue(followed, "follow_up_mode")).toBe("all");

		const session = t.world.parts.hosts.session(live.ref.sessionId);
		expect(session?.autoCompactionEnabled).toBe(false);
		expect(session?.autoRetryEnabled).toBe(false);
		expect(session?.steeringMode).toBe("all");
		expect(session?.followUpMode).toBe("all");

		const saved = globalSettingsFile(t);
		expect(saved).toMatchObject({
			compaction: { enabled: false, keepRecentTokens: 1 },
			retry: { enabled: false, baseDelayMs: 1 },
			steeringMode: "all",
			followUpMode: "all",
			defaultProvider: before.defaultProvider,
			defaultModel: before.defaultModel,
			extensions: before.extensions,
		});
	});

	test("is what a terminal pi, and the next session, read from the same files", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		await callSettings(t, live.ref, { kind: "toggle", key: "auto_compaction", enabled: false });
		await callSettings(t, live.ref, { kind: "choice", key: "follow_up_mode", value: "all" });

		const terminal = SettingsManager.create(t.cwd, t.world.env.agentDir);
		expect(terminal.getCompactionEnabled()).toBe(false);
		expect(terminal.getFollowUpMode()).toBe("all");

		const next = await t.rig.openNew();
		const settings = settingsIn(await callSettings(t, next.ref));
		expect(settingValue(settings, "auto_compaction")).toBe(false);
		expect(settingValue(settings, "follow_up_mode")).toBe("all");
	});

	test("writes the project's settings never, and says when the project's own value wins", async () => {
		t = await LiveRig.create({ settings: { defaultProjectTrust: "always" } });
		const projectFile = join(t.cwd, ".pi", "settings.json");
		mkdirSync(join(t.cwd, ".pi"), { recursive: true });
		writeFileSync(projectFile, JSON.stringify({ compaction: { enabled: false } }));
		const live = await t.rig.openNew();

		const shown = settingsIn(await callSettings(t, live.ref));
		expect(settingValue(shown, "auto_compaction")).toBe(false);
		expect(shown.find((setting) => setting.key === "auto_compaction")?.note).toContain("project");
		expect(shown.find((setting) => setting.key === "auto_retry")?.note).toBeUndefined();

		const changed = settingsIn(
			await callSettings(t, live.ref, { kind: "toggle", key: "auto_compaction", enabled: true }),
		);
		expect(settingValue(changed, "auto_compaction")).toBe(false);
		expect(globalSettingsFile(t)).toMatchObject({ compaction: { enabled: true } });
		expect(JSON.parse(await Bun.file(projectFile).text())).toEqual({ compaction: { enabled: false } });
	});

	test("changes a running session too, and is refused for a key or value it does not know", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "hold" });
		await live.prompt("Work for a while.");
		await live.waitFor("run_started");

		const changed = settingsIn(await callSettings(t, live.ref, { kind: "choice", key: "steering_mode", value: "all" }));
		expect(settingValue(changed, "steering_mode")).toBe("all");

		const before = globalSettingsFile(t);
		expect(refusal(await callSettings(t, live.ref, { kind: "toggle", key: "no_such", enabled: true }))).toStartWith(
			"invalid_input:",
		);
		expect(refusal(await callSettings(t, live.ref, { kind: "choice", key: "auto_retry", value: "all" }))).toStartWith(
			"invalid_input:",
		);
		expect(
			refusal(await callSettings(t, live.ref, { kind: "toggle", key: "steering_mode", enabled: true })),
		).toStartWith("invalid_input:");
		expect(
			refusal(await callSettings(t, live.ref, { kind: "choice", key: "steering_mode", value: "sometimes" })),
		).toStartWith("invalid_input:");
		expect(globalSettingsFile(t)).toEqual(before);
		await live.control.abort();
	});

	test("says so when the change could not be saved, though the session has it", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const file = join(t.world.env.agentDir, "settings.json");
		rmSync(file);
		mkdirSync(file);

		const failed = await callSettings(t, live.ref, { kind: "toggle", key: "auto_retry", enabled: false });
		expect(refusal(failed)).toStartWith("backend_error: the change applies to this session but could not be saved");
		expect(t.world.parts.hosts.session(live.ref.sessionId)?.autoRetryEnabled).toBe(false);
	});
});

describe("a session that cannot be changed from here", () => {
	test("an unknown session is not_found", async () => {
		t = await LiveRig.create();
		const ghost = { backend: "pi", sessionId: crypto.randomUUID() } as const;
		expect(refusal(await callSettings(t, ghost))).toStartWith("not_found:");
	});

	test("a session this bridge made but does not have open is not_found, and opening it makes it answer", async () => {
		t = await LiveRig.create();
		await t.driver.seedSessions(t.cwd, 1);
		const listed = await t.backend.listSessions({ archived: false }, { limit: 10 });
		if (listed.status !== "accepted") throw new Error("listing failed");
		const ref = listed.page.items[0]?.session;
		if (!ref) throw new Error("no seeded session");
		expect(refusal(await callSettings(t, ref))).toStartWith("not_found:");

		const opened = await t.rig.open(ref);
		expect(settingsIn(await callSettings(t, ref))).toHaveLength(4);
		await opened.close();
	});

	test("a session another client made is unsupported, and one a terminal has open is too", async () => {
		t = await LiveRig.create();
		const path = writeSessionFile(
			t.world.sessionsRoot,
			{ id: "other-client", cwd: t.cwd, version: 3 },
			conversation(["from the old app", "answer"]),
		);
		const later = new Date(Date.now() - 3_600_000);
		utimesSync(path, later, later);
		const ref = { backend: "pi", sessionId: "other-client" } as const;
		const watching = await t.rig.open(ref);
		expect(sessionCapabilities(watching.session).controllable).toBe(false);
		expect(refusal(await callSettings(t, ref))).toStartWith("unsupported: Another client");
		expect(readEntries(path).filter((entry) => entry.type === "custom")).toEqual([]);

		const gone = t.world.parts.terminal.registry.add({
			pid: 4242,
			sessionPath: path,
			sessionId: "other-client",
			feed: new TerminalFeed(Date.now, () => {}),
			command: async () => ({ ok: false, code: "backend_error", message: "a fake terminal" }),
		});
		expect(refusal(await callSettings(t, ref))).toStartWith("unsupported: A terminal");
		gone();
		await watching.close();
	});
});
