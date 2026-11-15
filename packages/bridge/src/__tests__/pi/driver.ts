/**
 * The Pi conformance driver (contract README §14): a throwaway agent dir, the real `pi` in RPC mode against the scripted
 * endpoint, scripts routed per session by the session id Pi sends with every request, and an extension file in the
 * agent dir that holds a run, raises Pi's dialogs and runs a subagent on cue.
 */

import type { AgentBackend, BackendHost, SessionRef } from "../../contract";
import { SessionRecorder } from "../../contract/testing/conformance-harness";
import type {
	ConformanceDriver,
	ConformanceFactory,
	DeliveredInput,
	Scenario,
} from "../../contract/testing/conformance-types";
import { deliveredInput } from "./helpers/delivered";
import { PiWorld, type PiWorldOptions } from "./helpers/pi-world";
import { say, scenarioSteps } from "./helpers/scenarios";
import { findSessionFile } from "./helpers/session-files";
import { TerminalRig } from "./helpers/terminal-rig";

export class PiConformanceDriver implements ConformanceDriver {
	readonly cwd: string;
	readonly otherCwd: string;
	private readonly terminals: TerminalRig;

	constructor(
		readonly world: PiWorld,
		private readonly timeoutMs: number,
	) {
		this.cwd = world.env.cwd;
		this.otherCwd = world.env.otherCwd;
		this.terminals = new TerminalRig({ world });
	}

	/** Sessions are made and run through the backend, so each is `origin: "broski"` and controllable. */
	async seedSessions(cwd: string, count: number): Promise<void> {
		for (let index = 0; index < count; index++) await this.seedOne(cwd);
	}

	async arrange(session: SessionRef, scenario: Scenario): Promise<boolean> {
		const steps = scenarioSteps(this.world.router, session.sessionId, scenario);
		if (!steps) return false;
		if (scenario.kind === "interaction" && scenario.interaction === "tool_permission") {
			const control = this.world.controlOf(session.sessionId);
			if ((await control?.setMode("permissions", "ask"))?.status !== "accepted") return false;
		}
		this.world.router.replace(session.sessionId, steps);
		return true;
	}

	async release(session: SessionRef): Promise<void> {
		this.world.router.release(session.sessionId);
	}

	quiesce(): Promise<void> {
		return this.world.activity.settle(() => this.world.server.busy());
	}

	delivered(session: SessionRef): Promise<DeliveredInput | undefined> {
		return deliveredInput(this.world.backend, this.world.router.requests(session.sessionId).at(-1), session);
	}

	/**
	 * The other client is a terminal `pi` resuming the session, whose Broski link extension (installed by the bridge) tells
	 * the bridge what it runs. The world must have the link on (`PiWorldOptions.link`).
	 */
	async runExternally(session: SessionRef): Promise<boolean> {
		const file = findSessionFile(this.world.sessionsRoot, session.sessionId);
		if (file === undefined) return false;
		const terminal = await this.terminals.open(file);
		await this.terminals.connected(file);
		this.world.router.script(session.sessionId, [say("Done there.")]);
		void terminal.session.prompt("From the terminal.");
		return true;
	}

	/** Ends the terminals the driver started. */
	quitTerminals(): Promise<void> {
		return this.terminals.quit();
	}

	restart(host: BackendHost): Promise<AgentBackend> {
		return this.world.restart(host);
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
	/** Removes every world the factory made, after the terminals its drivers started have quit; call it after each test. */
	dispose(): Promise<void>;
}

/**
 * A `ConformanceFactory` whose every call makes a new world: its own temp home, endpoint, backend and driver. The rule
 * disposes the backend; the kit's `dispose` removes the directories, and fails when a request escaped the endpoint.
 */
export function piConformanceKit(timeoutMs: number, options: PiWorldOptions = {}): PiConformanceKit {
	const worlds: PiWorld[] = [];
	const drivers: PiConformanceDriver[] = [];
	return {
		factory: async (host) => {
			const world = await PiWorld.create(host, options);
			worlds.push(world);
			const driver = new PiConformanceDriver(world, timeoutMs);
			drivers.push(driver);
			return { backend: world.backend, driver };
		},
		dispose: async () => {
			for (const driver of drivers.splice(0)) await driver.quitTerminals();
			const made = worlds.splice(0);
			const escapes = made.flatMap((world) => world.server.escapes());
			for (const world of made) world.dispose();
			if (escapes.length > 0) throw new Error(`requests escaped the scripted endpoint: ${escapes.join(", ")}`);
		},
	};
}
