/**
 * Pi Session Lifecycle Integration Tests
 *
 * Tests the 4 session lifecycle operations that were migrated from
 * AgentSession to our bridge-level implementation (Pi SDK v0.65.2):
 *
 *   1. createNewSession  — create a fresh empty session
 *   2. switchToSession   — switch to an existing session by path
 *   3. forkSession       — fork from a specific user message
 *   4. importFromJsonl   — import a JSONL file as a new session
 *
 * These tests use REAL Pi sessions with a cheap model (haiku) to verify
 * the full teardown → rebuild → re-bind lifecycle works end-to-end.
 *
 * Requires: ~/.pi/agent/auth.json with at least one configured provider.
 *
 * Run:  bun test src/__tests__/pi_lifecycle.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PiInstance } from "../connectors/pi";
import * as pi from "../connectors/pi";

// ── Helpers ──────────────────────────────────────────────────────────

/** Temp directory used as cwd for all tests. Cleaned up after. */
let testCwd: string;

/** Providers with credentials configured in ~/.pi/agent/auth.json. */
const configuredProviders = pi.getAuthStorage().list();
const hasConfiguredProvider = configuredProviders.length > 0;

/** Pick the cheapest available model from a provider that has credentials configured. */
function pickCheapModel(): { provider: string; modelId: string } | undefined {
	const models = pi.listAvailableModels().filter((m) => configuredProviders.includes(m.provider));
	// Prefer haiku (cheapest), then any flash/lite model, then first available
	const preferred = ["haiku", "flash-lite", "flash", "mini"];
	for (const hint of preferred) {
		const match = models.find((m) => m.id.includes(hint));
		if (match) return { provider: match.provider, modelId: match.id };
	}
	const fallback = models[0];
	return fallback ? { provider: fallback.provider, modelId: fallback.id } : undefined;
}

/** Collect stream events from a Pi instance for a short window. */
function collectEvents(instance: PiInstance, durationMs = 500): Promise<string[]> {
	return new Promise((resolve) => {
		const types: string[] = [];
		const unsub = instance.session.subscribe((event) => {
			types.push(event.type);
		});
		setTimeout(() => {
			unsub();
			resolve(types);
		}, durationMs);
	});
}

// ── Setup / Teardown ────────────────────────────────────────────────

beforeAll(() => {
	testCwd = mkdtempSync(join(tmpdir(), "broski-pi-lifecycle-"));
	mkdirSync(testCwd, { recursive: true });
});

afterAll(() => {
	pi.disposeAll();
	try {
		rmSync(testCwd, { recursive: true, force: true });
	} catch {
		// best-effort cleanup
	}
});

// ── Tests ───────────────────────────────────────────────────────────

describe.skipIf(!hasConfiguredProvider)("Pi Session Lifecycle", () => {
	test("can create instance and verify initial state", async () => {
		const model = pickCheapModel();
		if (!model) {
			console.warn("No Pi models available — skipping lifecycle tests");
			return;
		}

		const instance = await pi.getOrCreateInstance(testCwd, model);

		expect(instance).toBeDefined();
		expect(instance.cwd).toBe(resolve(testCwd));
		expect(instance.session).toBeDefined();
		expect(instance.session.sessionId).toBeTruthy();

		const state = pi.mapStatePayload(instance);
		expect(state.isStreaming).toBe(false);
		expect(state.model).toBeTruthy();
		expect(state.sessionId).toBeTruthy();
	}, 30_000);

	test("createNewSession — creates a fresh session with new ID", async () => {
		const instance = await pi.getOrCreateInstance(testCwd);
		const oldSessionId = instance.session.sessionId;
		const oldSessionFile = instance.session.sessionFile;

		const result = await pi.createNewSession(instance);

		expect(result.cancelled).toBe(false);
		// After rebuild, the instance should have a new session
		expect(instance.session).toBeDefined();
		expect(instance.session.sessionId).toBeTruthy();
		expect(instance.session.sessionId).not.toBe(oldSessionId);
		// Session file should change (or both could be null for in-memory)
		if (oldSessionFile) {
			expect(instance.session.sessionFile).not.toBe(oldSessionFile);
		}
		// State should be valid
		const state = pi.mapStatePayload(instance);
		expect(state.isStreaming).toBe(false);
		expect(state.messageCount).toBe(0);
	}, 30_000);

	test("createNewSession — event subscription survives rebuild", async () => {
		const instance = await pi.getOrCreateInstance(testCwd);
		let eventReceived = false;

		// Add listener BEFORE rebuild
		const removeListener = await pi.addEventListener(testCwd, () => {
			eventReceived = true;
		});

		await pi.createNewSession(instance);

		// The listener set is stable — it shouldn't have been cleared
		expect(instance.listeners.size).toBeGreaterThanOrEqual(1);

		removeListener();
	}, 30_000);

	test("switchToSession — switches to a different session and back", async () => {
		const instance = await pi.getOrCreateInstance(testCwd);

		// Create session A
		await pi.createNewSession(instance);
		const sessionA_file = instance.session.sessionFile;

		// Create session B
		await pi.createNewSession(instance);
		const sessionB_file = instance.session.sessionFile;

		expect(sessionA_file).toBeTruthy();
		expect(sessionB_file).toBeTruthy();
		expect(sessionA_file).not.toBe(sessionB_file);

		// Switch back to session A — verify by session file path
		if (sessionA_file) {
			const result = await pi.switchToSession(instance, sessionA_file);
			expect(result.cancelled).toBe(false);
			expect(instance.session.sessionFile).toBe(sessionA_file);
		}

		// Switch to session B
		if (sessionB_file) {
			const result = await pi.switchToSession(instance, sessionB_file);
			expect(result.cancelled).toBe(false);
			expect(instance.session.sessionFile).toBe(sessionB_file);
		}
	}, 60_000);

	test("prompt + createNewSession — messages reset after new session", async () => {
		const instance = await pi.getOrCreateInstance(testCwd);
		await pi.createNewSession(instance);

		// Send a short prompt
		const promptDone = new Promise<void>((resolve) => {
			const unsub = instance.session.subscribe((event) => {
				if (event.type === "agent_end") {
					unsub();
					resolve();
				}
			});
		});

		await instance.session.prompt("Say exactly: test123", { source: "rpc" });
		await promptDone;

		// Verify messages exist
		expect(instance.session.messages.length).toBeGreaterThan(0);
		const oldMessageCount = instance.session.messages.length;

		// Create new session — messages should reset
		await pi.createNewSession(instance);
		expect(instance.session.messages.length).toBe(0);
		expect(instance.session.messages.length).toBeLessThan(oldMessageCount);
	}, 60_000);

	test("forkSession — forks from a user message", async () => {
		const instance = await pi.getOrCreateInstance(testCwd);
		await pi.createNewSession(instance);

		// Send a prompt to create a user message we can fork from
		const promptDone = new Promise<void>((resolve) => {
			const unsub = instance.session.subscribe((event) => {
				if (event.type === "agent_end") {
					unsub();
					resolve();
				}
			});
		});

		await instance.session.prompt("Reply with just the word: alpha", { source: "rpc" });
		await promptDone;

		const parentSessionId = instance.session.sessionId;

		// Get fork-able messages
		const forkMessages = pi.mapForkMessages(instance);
		expect(forkMessages.length).toBeGreaterThan(0);

		const firstUserMessage = forkMessages[0];
		if (!firstUserMessage) throw new Error("Expected at least one forkable user message");
		expect(firstUserMessage.entryId).toBeTruthy();

		// Fork from the first user message
		const result = await pi.forkSession(instance, firstUserMessage.entryId);

		expect(result.cancelled).toBe(false);
		expect(result.selectedText).toBeTruthy();
		// After fork, we should be in a new session
		expect(instance.session.sessionId).not.toBe(parentSessionId);
	}, 60_000);

	test("importFromJsonl — imports a session file", async () => {
		const instance = await pi.getOrCreateInstance(testCwd);
		await pi.createNewSession(instance);

		// Create a minimal valid JSONL file to import
		const jsonlDir = join(testCwd, "test-imports");
		mkdirSync(jsonlDir, { recursive: true });
		const jsonlPath = join(jsonlDir, "test-import.jsonl");

		// Write a minimal session JSONL — just a header entry
		const header = JSON.stringify({
			type: "session",
			id: "test-import-session",
			cwd: testCwd,
			timestamp: new Date().toISOString(),
		});
		writeFileSync(jsonlPath, header + "\n");

		const oldSessionId = instance.session.sessionId;
		const result = await pi.importFromJsonl(instance, jsonlPath);

		expect(result.cancelled).toBe(false);
		// After import, session should have changed
		expect(instance.session.sessionId).not.toBe(oldSessionId);
	}, 30_000);

	test("deleteSession — deleting active session triggers new session", async () => {
		const instance = await pi.getOrCreateInstance(testCwd);
		await pi.createNewSession(instance);

		// Send a prompt so the session gets persisted to disk
		const promptDone = new Promise<void>((resolve) => {
			const unsub = instance.session.subscribe((event) => {
				if (event.type === "agent_end") {
					unsub();
					resolve();
				}
			});
		});
		await instance.session.prompt("Say: hello", { source: "rpc" });
		await promptDone;

		const sessionFile = instance.session.sessionFile;
		const sessionId = instance.session.sessionId;

		expect(sessionFile).toBeTruthy();
		if (sessionFile) {
			expect(existsSync(sessionFile)).toBe(true);

			const deleted = await pi.deleteSession(sessionFile);
			expect(deleted).toBe(true);

			// After deleting the active session, a new session should have been created
			expect(instance.session.sessionFile).not.toBe(sessionFile);
		}
	}, 60_000);

	test("mapStatePayload — returns valid state after lifecycle operations", async () => {
		const instance = await pi.getOrCreateInstance(testCwd);

		// After any lifecycle operation, state should be self-consistent
		await pi.createNewSession(instance);
		const state = pi.mapStatePayload(instance);

		expect(state.model).toBeTruthy();
		expect(state.sessionId).toBeTruthy();
		expect(typeof state.isStreaming).toBe("boolean");
		expect(typeof state.messageCount).toBe("number");
		expect(typeof state.isCompacting).toBe("boolean");
	}, 30_000);

	test("multiple rapid createNewSession — no crash or leak", async () => {
		const instance = await pi.getOrCreateInstance(testCwd);
		const sessionIds = new Set<string>();

		// Rapid-fire 5 new sessions
		for (let i = 0; i < 5; i++) {
			await pi.createNewSession(instance);
			sessionIds.add(instance.session.sessionId);
		}

		// All sessions should have unique IDs
		expect(sessionIds.size).toBe(5);
		// Instance should still be functional
		const state = pi.mapStatePayload(instance);
		expect(state.isStreaming).toBe(false);
	}, 60_000);

	test("listSessions — session with content appears in list", async () => {
		const instance = await pi.getOrCreateInstance(testCwd);
		await pi.createNewSession(instance);

		// Send a prompt so the session has content and is fully persisted
		const promptDone = new Promise<void>((resolve) => {
			const unsub = instance.session.subscribe((event) => {
				if (event.type === "agent_end") {
					unsub();
					resolve();
				}
			});
		});
		await instance.session.prompt("Say: listed", { source: "rpc" });
		await promptDone;

		const currentFile = instance.session.sessionFile;
		expect(currentFile).toBeTruthy();

		const sessions = await pi.listSessions(testCwd);
		const paths = sessions.map((s) => s.path);

		// Session with content should appear in the list
		if (currentFile) expect(paths).toContain(currentFile);
		expect(sessions.length).toBeGreaterThanOrEqual(1);
	}, 60_000);
});
