import type { BackendHost } from "../backend";
import type { SessionRef } from "../ids";
import type { ConformanceDriver, ConformanceFactory, DeliveredInput, Scenario } from "./conformance-types";
import { createFakeBackend, type FakeBackend, type FakeBackendOptions } from "./fake-backend";
import { scenarioSteps } from "./fake-scenarios";

/** The fake backend and a driver that scripts it; `options` narrows what the fake can do. */
export function fakeConformanceFactory(options: FakeBackendOptions = {}): ConformanceFactory {
	return async (host) => {
		const backend = createFakeBackend(host, options);
		return { backend, driver: fakeDriver(backend, options.runsSurviveRestart === true) };
	};
}

const FAKE_CWD = "/fake/project";

/** Drives the fake through its controls. A restart moves it to the backend that took over. */
function fakeDriver(first: FakeBackend, runsSurviveRestart: boolean): ConformanceDriver {
	let backend = first;
	return {
		runsSurviveRestart,
		cwd: FAKE_CWD,
		otherCwd: "/fake/elsewhere",
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
		runExternally: async (session: SessionRef) => {
			backend.fake.runExternally(session, "From the terminal.", [{ kind: "text", text: "Done there." }]);
			return true;
		},
		watchedAsk: async () => {
			const steps = scenarioSteps(backend.traits, { kind: "interaction", interaction: "tool_permission" });
			if (!steps) return undefined;
			const session = backend.fake.seed({ cwd: FAKE_CWD, external: true, answerable: true });
			backend.fake.runExternally(session, "From the terminal.", steps);
			return session;
		},
		restart: async (host: BackendHost) => {
			backend = await backend.fake.restart(host);
			return backend;
		},
	};
}
