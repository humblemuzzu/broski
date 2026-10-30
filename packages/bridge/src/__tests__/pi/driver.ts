/**
 * The Pi conformance driver (contract README §14): a throwaway agent dir, pi-ai's faux provider on the
 * adapter's own `ModelRuntime`, scripts routed per session by the request's `sessionId`, and an
 * extension file in the agent dir that holds a run or raises Pi's dialogs on cue.
 */

import type { AgentBackend, BackendCall, BackendHost, BackendOpKind, SessionRef } from "../../contract";
import { SessionRecorder } from "../../contract/testing/conformance-harness";
import type {
	ConformanceDriver,
	ConformanceFactory,
	DeliveredInput,
	Scenario,
} from "../../contract/testing/conformance-types";
import { deliveredInput } from "./helpers/delivered";
import { PiWorld, type PiWorldOptions } from "./helpers/pi-world";
import { scenarioSteps } from "./helpers/scenarios";

export class PiConformanceDriver implements ConformanceDriver {
	readonly cwd: string;
	readonly otherCwd: string;

	constructor(
		readonly world: PiWorld,
		private readonly timeoutMs: number,
	) {
		this.cwd = world.env.cwd;
		this.otherCwd = world.env.otherCwd;
	}

	/** Sessions are made and run through the backend, so each is `origin: "broski"` and controllable. */
	async seedSessions(cwd: string, count: number): Promise<void> {
		for (let index = 0; index < count; index++) await this.seedOne(cwd);
	}

	async arrange(session: SessionRef, scenario: Scenario): Promise<boolean> {
		const steps = scenarioSteps(this.world.bus, session.sessionId, scenario);
		if (!steps) return false;
		if (scenario.kind === "interaction" && scenario.interaction === "tool_permission") {
			if (!(await this.askBeforeTools(session))) return false;
		}
		this.world.router.script(session.sessionId, steps);
		return true;
	}

	async release(session: SessionRef): Promise<void> {
		this.world.bus.release(session.sessionId);
	}

	quiesce(): Promise<void> {
		return this.world.activity.settle();
	}

	delivered(session: SessionRef): Promise<DeliveredInput | undefined> {
		return deliveredInput(this.world.backend, this.world.router, session);
	}

	async backendCall(session: SessionRef, op: BackendOpKind): Promise<BackendCall | undefined> {
		if (op !== "navigate_tree") return undefined;
		const read = await this.world.backend.readTranscript(session, { limit: 200 });
		if (read.status === "rejected") return undefined;
		const prompt = read.page.items.find((item) => item.kind === "user_message");
		return (
			prompt && { backend: "pi", op: { kind: op, sessionId: session.sessionId, itemId: prompt.id, summarize: false } }
		);
	}

	/** Pi declares no `externalLive`: no other client's run reaches this bridge (D16). */
	async runExternally(_session: SessionRef): Promise<boolean> {
		return false;
	}

	restart(host: BackendHost): Promise<AgentBackend> {
		return this.world.restart(host);
	}

	private async askBeforeTools(session: SessionRef): Promise<boolean> {
		const control = this.world.controlOf(session.sessionId);
		if (!control) return false;
		return (await control.setMode("permissions", "ask")).status === "accepted";
	}

	private async seedOne(cwd: string): Promise<void> {
		const recorder = new SessionRecorder(this.timeoutMs);
		const opened = await this.world.backend.open({ kind: "new", options: { cwd } }, recorder);
		if (opened.status === "rejected") throw new Error(`seeding: open was rejected: ${opened.rejection.message}`);
		const { session } = opened;
		if (!session.control) throw new Error("seeding: a session this bridge made cannot be controlled");
		await this.arrange(session.session, { kind: "reply" });
		const sent = await session.control.prompt({
			clientRequestId: crypto.randomUUID(),
			mode: "start",
			text: "Seed this session.",
			attachments: [],
			mentions: [],
		});
		if (sent.status === "rejected") throw new Error(`seeding: the prompt was rejected: ${sent.rejection.message}`);
		await recorder.waitFor(
			(records) => records.find((record) => record.event.type === "run_finished"),
			"the seeded run to finish",
		);
		await session.close();
	}
}

export interface PiConformanceKit {
	readonly factory: ConformanceFactory;
	/** Removes every world the factory made; call it after each test. */
	dispose(): void;
}

/**
 * A `ConformanceFactory` whose every call makes a new world: its own temp home, faux models, backend
 * and driver. The rule disposes the backend; the kit's `dispose` removes the directories.
 */
export function piConformanceKit(timeoutMs: number, options: PiWorldOptions = {}): PiConformanceKit {
	const worlds: PiWorld[] = [];
	return {
		factory: async (host) => {
			const world = await PiWorld.create(host, options);
			worlds.push(world);
			return { backend: world.backend, driver: new PiConformanceDriver(world, timeoutMs) };
		},
		dispose: () => {
			const made = worlds.splice(0);
			for (const world of made) world.dispose();
			for (const world of made) world.assertNotCapped();
		},
	};
}
