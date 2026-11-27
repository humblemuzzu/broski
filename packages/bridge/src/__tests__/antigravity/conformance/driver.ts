/**
 * The Antigravity conformance driver (contract README §14) on the user's own `agy` and sign-in: each rule gets a
 * production backend of its own over one shared world (`live/world.ts`: temp folders, the wire tap, the account's
 * guard), so sessions seeded for one rule count for the next. A scenario is what the session's next prompt tells the
 * model (`scenarios.ts`, which declines what agy cannot play); a hold is a permission agy waits on, which `release`
 * allows. What reached the model is read back from agy itself: the text and command from the session's `session/load`
 * replay (the transcript), and the images, which agy does not replay, from the `session/prompt` agy was sent, named as
 * the transcript names them. No other client can run in an agy session live (`externalLive` is false), none asks in a
 * session it owns that the bridge could answer, and a run ends with the bridge, since the bridge's front is its child.
 */

import { isRecord } from "../../../adapter-kit/bounded-json";
import type {
	AgentBackend,
	BackendHost,
	CommandsListResult,
	ImageContent,
	PromptInput,
	SessionRef,
} from "../../../contract";
import { SessionRecorder } from "../../../contract/testing/conformance-harness";
import { allPages } from "../../../contract/testing/conformance-reads";
import type {
	ConformanceDriver,
	ConformanceFactory,
	DeliveredInput,
	Scenario,
} from "../../../contract/testing/conformance-types";
import { validReply } from "../../../contract/testing/example-replies";
import { phoneWriting } from "../../../server/phone-writing";
import { Activity } from "../../claude-code/conformance/observed-backend";
import { eventually } from "../../helpers/workspace-rig";
import { HARMLESS_COMMANDS } from "../live/safety";
import { paramsOf, type WireLog } from "../live/wire-log";
import { AgyWorld, type LiveBackend } from "../live/world";
import { instructionFor, REPLY } from "./scenarios";

/** agy may still send a usage or title update a moment after a turn has ended. */
const QUIET_MS = 1_500;

/** What every session's next prompt is told: its arranged scenario once, else to reply. */
class Steering {
	private readonly armed = new Map<string, string>();

	arm(sessionId: string, instruction: string): void {
		this.armed.set(sessionId, instruction);
	}

	readonly rewrite = (session: SessionRef, input: PromptInput): PromptInput => {
		const instruction = this.armed.get(session.sessionId) ?? REPLY;
		this.armed.delete(session.sessionId);
		return input.command === undefined ? { ...input, text: instruction } : input;
	};
}

interface Shared {
	readonly world: AgyWorld;
	readonly steering: Steering;
	readonly activity: Activity;
	start(host: BackendHost): Promise<LiveBackend>;
}

export class AntigravityConformanceDriver implements ConformanceDriver {
	readonly runsSurviveRestart = false;
	readonly cwd: string;
	readonly otherCwd: string;

	constructor(
		private readonly shared: Shared,
		private live: LiveBackend,
		private readonly timeoutMs: number,
	) {
		this.cwd = shared.world.cwd;
		this.otherCwd = shared.world.otherCwd;
	}

	/** Only the sessions still missing are made, each by a real prompt through the backend. */
	async seedSessions(cwd: string, count: number): Promise<void> {
		const listed = await allPages(this.live.backend, { cwd }, 200);
		for (let made = listed.length; made < count; made += 1) await this.seedOne(cwd);
	}

	async arrange(session: SessionRef, scenario: Scenario): Promise<boolean> {
		const instruction = instructionFor(scenario);
		if (instruction === undefined) return false;
		this.shared.steering.arm(session.sessionId, instruction);
		return true;
	}

	/** Allows the permission the session's hold waits on, once agy has asked it. */
	async release(session: SessionRef): Promise<void> {
		const view = this.live.guarded.view(session.sessionId);
		const ask = await eventually(() => view?.snapshot().interactions[0], "the ask the hold waits on", this.timeoutMs);
		const answered = await view?.control?.answer({ interactionId: ask.id, reply: validReply(ask) });
		if (answered?.status !== "accepted")
			throw new Error(`the hold's ask was not answered: ${JSON.stringify(answered)}`);
	}

	quiesce(): Promise<void> {
		return this.shared.activity.settle(() => false, QUIET_MS);
	}

	delivered(session: SessionRef): Promise<DeliveredInput | undefined> {
		return deliveredInput(this.live.backend, this.shared.world.tap, session);
	}

	async runExternally(_session: SessionRef): Promise<boolean> {
		return false;
	}

	async restart(host: BackendHost): Promise<AgentBackend> {
		await this.live.backend.dispose();
		this.live = await this.shared.start(host);
		return harmlessCommandsFirst(this.live.backend);
	}

	private async seedOne(cwd: string): Promise<void> {
		const recorder = new SessionRecorder(this.timeoutMs);
		const opened = await this.live.backend.open({ kind: "new", options: { cwd } }, recorder);
		if (opened.status === "rejected") throw new Error(`seeding: open was rejected: ${opened.rejection.message}`);
		const { session } = opened;
		const sent = await session.control?.prompt({
			clientRequestId: crypto.randomUUID(),
			mode: "start",
			text: REPLY,
			attachments: [],
		});
		if (sent?.status !== "accepted") throw new Error(`seeding: the prompt was not taken: ${JSON.stringify(sent)}`);
		await recorder.waitFor(
			(records) => records.find((record) => record.event.type === "run_finished"),
			"the seeded run",
		);
		await session.close();
	}
}

/**
 * The commands as the backend lists them, those known harmless to run on the account first: the rule that runs a
 * command runs the first one listed that starts a run, and the guard refuses to send any other (`live/safety.ts`).
 */
function harmlessCommandsFirst(backend: AgentBackend): AgentBackend {
	const harmless = (id: string) => (HARMLESS_COMMANDS.has(id) ? 0 : 1);
	return {
		...backend,
		listCommands: async (scope): Promise<CommandsListResult> => {
			const listed = await backend.listCommands(scope);
			if (listed.status === "rejected") return listed;
			return { ...listed, commands: [...listed.commands].sort((a, b) => harmless(a.id) - harmless(b.id)) };
		},
	};
}

async function deliveredInput(
	backend: AgentBackend,
	tap: WireLog,
	session: SessionRef,
): Promise<DeliveredInput | undefined> {
	const read = await backend.readTranscript(session, { limit: 200 });
	if (read.status === "rejected") return undefined;
	const message = read.page.items.find((item) => item.kind === "user_message");
	if (message?.kind !== "user_message") return undefined;
	const listed = await backend.listCommands({ session });
	const commands = new Set(listed.status === "accepted" ? listed.commands.map((command) => command.id) : []);
	const named = /^\/(\S+)\s*([\s\S]*)$/.exec(message.text);
	const command = named?.[1] !== undefined && commands.has(named[1]) ? named[1] : undefined;
	const names = message.attachments.flatMap((attachment) => (attachment.kind === "image_ref" ? [attachment.name] : []));
	return {
		text: command === undefined ? message.text : (named?.[2] ?? "").trim(),
		attachments: sentImages(tap, session).map((image, index) => {
			const name = names[index];
			return name === undefined ? image : { ...image, name };
		}),
		...(command !== undefined && { command }),
	};
}

/** The image blocks of the newest `session/prompt` agy was sent for the session. */
function sentImages(tap: WireLog, session: SessionRef): ImageContent[] {
	const sent = tap.exchanges("session/prompt", session.sessionId).at(-1);
	const blocks = sent === undefined ? undefined : paramsOf(sent.request).prompt;
	return (Array.isArray(blocks) ? blocks : []).flatMap((block: unknown): ImageContent[] => {
		if (!isRecord(block) || block.type !== "image") return [];
		const { mimeType, data } = block;
		return typeof mimeType === "string" && typeof data === "string" ? [{ kind: "image", mimeType, data }] : [];
	});
}

export interface AntigravityConformanceKit {
	readonly factory: ConformanceFactory;
	/** Disposes every backend still running and removes the shared world's folders; call it once, after the rules. */
	dispose(): Promise<void>;
}

export function antigravityConformanceKit(timeoutMs: number): AntigravityConformanceKit {
	const steering = new Steering();
	const activity = new Activity();
	let shared: Shared | undefined;
	const sharedWorld = (): Shared => {
		if (shared !== undefined) return shared;
		const world = AgyWorld.create({ label: "conformance", phoneNote: phoneWriting(true) });
		const start = (host: BackendHost) =>
			world.start({ host, rewrite: steering.rewrite, emitted: () => activity.touch() });
		shared = { world, steering, activity, start };
		return shared;
	};
	return {
		factory: async (host) => {
			const parts = sharedWorld();
			const live = await parts.start(host);
			return {
				backend: harmlessCommandsFirst(live.backend),
				driver: new AntigravityConformanceDriver(parts, live, timeoutMs),
			};
		},
		dispose: async () => {
			await shared?.world.dispose();
		},
	};
}
