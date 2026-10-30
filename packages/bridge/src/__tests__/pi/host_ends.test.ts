/**
 * What a host's end and its events lean on in Pi: a runtime is disposed even when its abort fails, the entry of a
 * message is found when something was appended after it in the same task, and a usage pull reads the context once.
 */

import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { persistedEntryId } from "../../backends/pi/live/persisted-entry";
import { shutdownRuntime } from "../../backends/pi/live/shutdown";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig } from "./host_rig";

useWatchdog();

let t: HostRig | undefined;

afterEach(async () => {
	mock.restore();
	await t?.dispose();
	t = undefined;
});

function runtimeOf(rig: HostRig, sessionId: string): AgentSessionRuntime {
	const host = Reflect.get(rig.hosts, "hosts").get(sessionId);
	const runtime: AgentSessionRuntime | undefined = Reflect.get(host, "runtime");
	if (!runtime) throw new Error("the session has no runtime");
	return runtime;
}

test("a runtime whose abort rejects is still disposed, and its extensions told", async () => {
	t = await HostRig.create();
	const live = await t.rig.rig.openNew();
	const runtime = runtimeOf(t, live.ref.sessionId);
	spyOn(runtime.session, "abort").mockRejectedValue(new Error("the abort broke"));
	const dispose = spyOn(runtime, "dispose");

	await shutdownRuntime(runtime);

	expect(dispose).toHaveBeenCalledTimes(1);
	expect(t.bus.liveRuntimes()).toBe(0);
});

test("a message's entry is found though another entry was appended after it first", () => {
	const manager = SessionManager.inMemory("/tmp");
	const message = { role: "user" as const, content: "hi", timestamp: 1 };
	manager.appendMessage(message);
	const stored = manager.getEntries().at(-1);
	manager.appendModelChange("faux", "other");
	manager.appendCustomEntry("broski.permissions", { mode: "ask", allowedTools: [] });

	if (stored?.type !== "message") throw new Error("the message was not stored");
	expect(persistedEntryId(manager, stored.message)).toBe(stored.id);
	expect(() => persistedEntryId(manager, { role: "user", content: "never stored", timestamp: 2 })).toThrow();
});

test("a usage pull reads Pi's context usage once, inside its session stats", async () => {
	t = await HostRig.create();
	const live = await t.rig.rig.openNew();
	await t.rig.rig.arrange(live.ref, { kind: "reply" });
	const session = t.session(live.ref);
	const stats = spyOn(session, "getSessionStats");
	const context = spyOn(session, "getContextUsage");

	await live.run("count");

	expect(stats.mock.calls.length).toBeGreaterThan(0);
	expect(context.mock.calls.length).toBe(stats.mock.calls.length);
});
