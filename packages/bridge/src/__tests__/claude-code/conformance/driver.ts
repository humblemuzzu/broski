/**
 * The Claude Code conformance driver (contract README §14): the real CLI against the scripted endpoint in a throwaway
 * home, one script per session (`session-router.ts`). Sessions are seeded by real runs through the backend, so every
 * seeded row is `origin: "broski"` and has the history a run writes (fixture transcripts are the store's own tests).
 */

import type { AgentBackend, BackendHost, SessionRef } from "../../../contract";
import { SessionRecorder } from "../../../contract/testing/conformance-harness";
import type {
	ConformanceDriver,
	ConformanceFactory,
	DeliveredInput,
	Scenario,
} from "../../../contract/testing/conformance-types";
import { deliveredInput } from "./delivered";
import { scenarioSteps } from "./scenarios";
import { ClaudeWorld } from "./world";

export class ClaudeCodeConformanceDriver implements ConformanceDriver {
	readonly cwd: string;
	readonly otherCwd: string;
	readonly agentName = "general-purpose";

	constructor(
		readonly world: ClaudeWorld,
		private readonly timeoutMs: number,
	) {
		this.cwd = world.home.projectDir;
		this.otherCwd = world.otherCwd;
	}

	async seedSessions(cwd: string, count: number): Promise<void> {
		for (let index = 0; index < count; index++) await this.seedOne(cwd);
	}

	async arrange(session: SessionRef, scenario: Scenario): Promise<boolean> {
		const { router } = this.world;
		if (scenario.kind === "echo_model") await this.world.models.load();
		const steps = scenarioSteps(scenario, {
			cwd: this.cwd,
			gate: () => router.gate(session.sessionId),
			echo: (request) => this.world.models.echo(request),
		});
		if (!steps) return false;
		if (scenario.kind === "interaction" && scenario.interaction === "plan_approval") {
			const control = this.world.controlOf(session.sessionId);
			if ((await control?.setMode("permissions", "plan"))?.status !== "accepted") return false;
		}
		router.replace(session.sessionId, steps);
		return true;
	}

	async release(session: SessionRef): Promise<void> {
		this.world.router.release(session.sessionId);
	}

	quiesce(): Promise<void> {
		return this.world.activity.settle(() => false);
	}

	delivered(session: SessionRef): Promise<DeliveredInput | undefined> {
		const newest = this.world.router.requests(session.sessionId).at(-1);
		return deliveredInput(this.world.backend, newest, session);
	}

	/** `externalLive` is false (adapter README D28): no other client runs live here. */
	async runExternally(_session: SessionRef): Promise<boolean> {
		return false;
	}

	restart(host: BackendHost): Promise<AgentBackend> {
		return this.world.restart(host);
	}

	/** A real second CLI asks through the installed hook; the adapter raises it on the session it opens watch-only. */
	watchedAsk(): Promise<SessionRef> {
		const { world } = this;
		return world.terminalAsks.watchedAsk({
			configDir: world.home.configDir,
			projectDir: world.home.projectDir,
			cliPath: world.cliPath,
			env: world.env,
			router: world.router,
		});
	}

	private async seedOne(cwd: string): Promise<void> {
		const recorder = new SessionRecorder(this.timeoutMs);
		const opened = await this.world.backend.open({ kind: "new", options: { cwd } }, recorder);
		if (opened.status === "rejected") throw new Error(`seeding: open was rejected: ${opened.rejection.message}`);
		const { session } = opened;
		if (!session.control) throw new Error("seeding: a session this bridge made cannot be controlled");
		this.world.router.script(session.session.sessionId, [{ text: ["Seeded."] }]);
		const sent = await session.control.prompt({
			clientRequestId: crypto.randomUUID(),
			mode: "start",
			text: "Seed this session.",
			attachments: [],
		});
		if (sent.status === "rejected") throw new Error(`seeding: the prompt was rejected: ${sent.rejection.message}`);
		await recorder.waitFor((records) => records.find((record) => record.event.type === "run_finished"), "seeded run");
		await session.close();
	}
}

export interface ClaudeCodeConformanceKit {
	readonly factory: ConformanceFactory;
	/** Stops every world's endpoint and removes its home; fails when a request left the scripted endpoint. */
	dispose(): Promise<void>;
}

export function claudeCodeConformanceKit(timeoutMs: number): ClaudeCodeConformanceKit {
	const worlds: ClaudeWorld[] = [];
	return {
		factory: async (host) => {
			const world = await ClaudeWorld.create(host);
			worlds.push(world);
			return { backend: world.backend, driver: new ClaudeCodeConformanceDriver(world, timeoutMs) };
		},
		dispose: async () => {
			const made = worlds.splice(0);
			const escapes = made.flatMap((world) => world.escapes());
			for (const world of made) await world.dispose();
			if (escapes.length > 0) throw new Error(`requests escaped the scripted endpoint: ${escapes.join(", ")}`);
		},
	};
}
