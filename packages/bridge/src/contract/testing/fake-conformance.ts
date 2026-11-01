import type { BackendHost } from "../backend";
import type { BackendOpKind } from "../backend-ops";
import type { SessionRef } from "../ids";
import type { ConformanceDriver, ConformanceFactory, DeliveredInput, Scenario } from "./conformance-types";
import { exampleCall } from "./example-ops";
import { createFakeBackend, type FakeBackend, type FakeBackendOptions } from "./fake-backend";
import { scenarioSteps } from "./fake-scenarios";

/** The fake backend and a driver that scripts it; `options` narrows what the fake can do. */
export function fakeConformanceFactory(options: FakeBackendOptions = {}): ConformanceFactory {
	return async (host) => {
		const backend = createFakeBackend(host, options);
		return { backend, driver: fakeDriver(backend) };
	};
}

const FAKE_CWD = "/fake/project";

/** Drives the fake through its controls. A restart moves it to the backend that took over. */
function fakeDriver(first: FakeBackend): ConformanceDriver {
	let backend = first;
	return {
		cwd: FAKE_CWD,
		otherCwd: "/fake/elsewhere",
		agentName: "reviewer",
		seedSessions: async (cwd: string, count: number) => {
			for (let index = 0; index < count; index++) backend.fake.seed({ cwd, title: `Seeded ${index}` });
		},
		arrange: async (session: SessionRef, scenario: Scenario) => {
			if (scenario.kind === "slow_compaction") {
				backend.fake.slowCompaction(session);
				return true;
			}
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
			return (
				prompt && exampleCall(session.backend, op, { sessionId: session.sessionId, itemId: prompt.id, cwd: FAKE_CWD })
			);
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
