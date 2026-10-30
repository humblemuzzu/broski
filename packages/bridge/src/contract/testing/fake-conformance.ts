import type { BackendHost } from "../backend";
import type { BackendCall, BackendOpKind } from "../backend-ops";
import type { SessionRef } from "../ids";
import type { ConformanceDriver, ConformanceFactory, DeliveredInput, Scenario } from "./conformance-types";
import { createFakeBackend, type FakeBackend, type FakeBackendOptions } from "./fake-backend";
import { scenarioSteps } from "./fake-scenarios";

/** The fake backend and a driver that scripts it; `options` narrows what the fake can do. */
export function fakeConformanceFactory(options: FakeBackendOptions = {}): ConformanceFactory {
	return async (host) => {
		const backend = createFakeBackend(host, options);
		return { backend, driver: fakeDriver(backend) };
	};
}

/** Drives the fake through its controls. A restart moves it to the backend that took over. */
function fakeDriver(first: FakeBackend): ConformanceDriver {
	let backend = first;
	return {
		cwd: "/fake/project",
		otherCwd: "/fake/elsewhere",
		agentName: "reviewer",
		seedSessions: async (cwd: string, count: number) => {
			for (let index = 0; index < count; index++) backend.fake.seed({ cwd, title: `Seeded ${index}` });
		},
		arrange: async (session: SessionRef, scenario: Scenario) => {
			const steps = scenarioSteps(backend.traits, scenario);
			if (steps) backend.fake.script(session, steps);
			return steps !== undefined;
		},
		release: async (session: SessionRef) => backend.fake.release(session),
		/** The fake works in microtasks only, so they have all run by the next macrotask. */
		quiesce: () => new Promise((resolve) => setImmediate(resolve)),
		delivered: async (session: SessionRef): Promise<DeliveredInput | undefined> => backend.fake.delivered(session),
		backendCall: async (session: SessionRef, op: BackendOpKind) => {
			const read = await backend.readTranscript(session, { limit: 200 });
			if (read.status === "rejected") return undefined;
			const prompt = read.page.items.find((item) => item.kind === "user_message");
			return prompt && exampleCall(op, session.sessionId, prompt.id);
		},
		runExternally: async (session: SessionRef) => {
			backend.fake.runExternally(session, "From the terminal.", [{ kind: "text", text: "Done there." }]);
			return true;
		},
		restart: async (host: BackendHost) => {
			backend = await backend.fake.restart(host);
			return backend;
		},
	};
}

/** A call of `op` that points at `itemId`, for the backend whose op it is. */
function exampleCall(op: BackendOpKind, sessionId: string, itemId: string): BackendCall {
	switch (op) {
		case "rewind_files":
			return { backend: "claude-code", op: { kind: op, sessionId, userItemId: itemId, dryRun: true } };
		case "review_start":
			return { backend: "codex", op: { kind: op, sessionId, target: { kind: "uncommitted" } } };
		case "revert":
			return { backend: "codex", op: { kind: op, sessionId, beforeItemId: itemId } };
		case "revert_stage":
			return { backend: "opencode", op: { kind: op, sessionId, itemId, restoreFiles: false } };
		case "revert_clear":
		case "revert_commit":
			return { backend: "opencode", op: { kind: op, sessionId } };
		case "navigate_tree":
			return { backend: "pi", op: { kind: op, sessionId, itemId, summarize: false } };
		case "take_over":
			return { backend: "pi", op: { kind: op, sessionId } };
	}
}
