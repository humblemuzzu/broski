import type { AgentBackend, BackendHost, BackendTraits } from "../backend";
import type { BackendId, InteractionId, SessionRef } from "../ids";
import type { ModeAxis } from "../modes";
import type { DeliveredInput } from "./conformance-types";
import { FAKE_COMMANDS, FAKE_MODES, FAKE_STATUS, FULL_TRAITS } from "./fake-data";
import { sessionPage } from "./fake-paging";
import type { FakeStep } from "./fake-script";
import { FakeSession } from "./fake-session";
import { offeredModels } from "./fake-validation";
import { type FakeMethods, type FakeSettings, type FakeStore, FakeWorld, type SeedOptions } from "./fake-world";

export type { FakeMethods, SeedOptions } from "./fake-world";

const ALL_METHODS: FakeMethods = {
	rename: true,
	delete: true,
	archive: true,
	fork: true,
	call: true,
	compact: true,
	cancelQueued: true,
};

export const NO_METHODS: FakeMethods = {
	rename: false,
	delete: false,
	archive: false,
	fork: false,
	call: false,
	compact: false,
	cancelQueued: false,
};

export interface FakeBackendOptions {
	readonly id?: BackendId;
	readonly traits?: BackendTraits;
	readonly methods?: FakeMethods;
	readonly modes?: readonly ModeAxis[];
	readonly now?: () => number;
	readonly newId?: () => string;
}

/** What a test can make the fake do that a real backend does on its own. */
export interface FakeControls {
	/** A session with one finished exchange in its history. */
	seed(options: SeedOptions): SessionRef;
	/** The next run of `session` plays `steps`; runs without a script reply "Done.". */
	script(session: SessionRef, steps: FakeStep[]): void;
	/** Ends a `hold` step of the session's active run. */
	release(session: SessionRef): void;
	/** Another client of the backend starts a run. */
	runExternally(session: SessionRef, text: string, steps: FakeStep[]): void;
	/** The adapter lost track and replaces the live state with a snapshot. */
	resync(session: SessionRef): void;
	/** The backend process died: pending asks expire and the run fails. */
	loseBackend(session: SessionRef): Promise<void>;
	/** Another client answered the interaction. */
	answerElsewhere(session: SessionRef, interactionId: InteractionId): void;
	/** The session's latest user input as it reached the model. */
	delivered(session: SessionRef): DeliveredInput | undefined;
	/**
	 * The bridge restarts: this backend is disposed and a new one starts over the same sessions.
	 * Runs survive exactly when the traits say `durableRuns`.
	 */
	restart(host: BackendHost): Promise<FakeBackend>;
}

export interface FakeBackend extends AgentBackend {
	readonly fake: FakeControls;
}

/** The reference `AgentBackend`: in memory, scriptable, able to show every capability the contract has. */
export function createFakeBackend(host: BackendHost, options: FakeBackendOptions = {}): FakeBackend {
	const settings: FakeSettings = {
		id: options.id ?? "pi",
		traits: options.traits ?? FULL_TRAITS,
		methods: options.methods ?? ALL_METHODS,
		modes: options.modes ?? FAKE_MODES,
		now: options.now ?? steadyClock(),
		newId: options.newId ?? (() => crypto.randomUUID()),
	};
	return backendOver(new FakeWorld(host, settings, new Map()));
}

/** Wall-clock milliseconds that never repeat, so every change has its own time and newest-first is one order. */
function steadyClock(): () => number {
	let last = 0;
	return () => {
		last = Math.max(Date.now(), last + 1);
		return last;
	};
}

function backendOver(world: FakeWorld): FakeBackend {
	const { traits, methods } = world.settings;
	return {
		id: world.id,
		traits,
		status: async () => FAKE_STATUS,
		listSessions: async (query, page) => sessionPage(world.rows(query), page),
		getSession: async (session) => world.summary(session),
		readTranscript: async (session, page) => {
			const found = world.find(session);
			return found instanceof FakeSession ? found.transcript(page) : found;
		},
		readAttachment: async (session, attachment) => {
			const found = world.find(session);
			return found instanceof FakeSession ? found.readAttachment(attachment) : found;
		},
		listModels: async () => ({ status: "accepted", models: offeredModels(traits) }),
		listCommands: async () => ({ status: "accepted", commands: traits.commands ? [...FAKE_COMMANDS] : [] }),
		listModes: async () => ({ status: "accepted", modes: [...world.modes] }),
		open: async (target, sink) => world.open(target, sink),
		...(methods.rename && { rename: async (session, title) => world.rename(session, title) }),
		...(methods.delete && { delete: async (session) => world.delete(session) }),
		...(methods.archive && { archive: async (session, archived) => world.archive(session, archived) }),
		...(methods.fork && { fork: async (session, at) => world.fork(session, at) }),
		...(methods.call && { call: async (call) => world.call(call) }),
		dispose: async () => world.dispose(),
		fake: controls(world),
	};
}

function controls(world: FakeWorld): FakeControls {
	return {
		seed: (options) => world.seed(options),
		script: (ref, steps) => world.session(ref).script(steps),
		release: (ref) => world.session(ref).release(),
		runExternally: (ref, text, steps) => world.session(ref).runExternally(text, steps),
		resync: (ref) => world.session(ref).resync(),
		loseBackend: (ref) => world.session(ref).loseBackend(),
		answerElsewhere: (ref, interactionId) => world.session(ref).answerElsewhere(interactionId),
		delivered: (ref) => world.session(ref).inbox.delivered(),
		restart: (host) => restart(world, host),
	};
}

async function restart(world: FakeWorld, host: BackendHost): Promise<FakeBackend> {
	world.dispose();
	const store: FakeStore = world.sessions;
	if (!world.traits.durableRuns) await Promise.all([...store.values()].map((session) => session.endWithTheBridge()));
	const next = new FakeWorld(host, world.settings, store);
	for (const session of store.values()) session.rebind(next);
	return backendOver(next);
}
