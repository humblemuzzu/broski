/**
 * The bridge core in process, with the fake backend registered and clients that speak the
 * contract protocol through in-memory links. Every frame a client receives is checked against the
 * contract's `ServerMessage` schema.
 */

import {
	type AgentBackend,
	type AgentEvent,
	type BackendHost,
	type BackendTraits,
	type ClientMessage,
	type ErrorResponse,
	type EventEnvelope,
	type JsonValue,
	PROTOCOL_VERSION,
	type PromptInput,
	type PromptMode,
	type ProtocolVersion,
	type ResponseFor,
	ServerMessage,
	type SessionRef,
	type SessionSnapshot,
} from "../../contract";
import { createFakeBackend, type FakeBackend, type FakeBackendOptions } from "../../contract/testing/fake-backend";
import { streamViolations, unsettledParts } from "../../contract/testing/stream-rules";
import { BridgeCore, type CoreConnection, type CoreOptions } from "../../core/core";
import type { CoreClock, CoreLog } from "../../core/ports";
import { type OpenRecord, recordingOpens } from "./core-adapters";

/** A clock whose timers fire only when the test advances it. */
export class ManualClock implements CoreClock {
	private time = 1_700_000_000_000;
	private nextId = 0;
	private readonly timers = new Map<number, { at: number; run: () => void }>();
	private readonly watchers: Array<{ count: number; resolve: () => void }> = [];

	now(): number {
		return this.time;
	}

	after(ms: number, run: () => void): () => void {
		const id = this.nextId++;
		this.timers.set(id, { at: this.time + ms, run });
		for (const watcher of this.watchers.splice(0)) {
			if (this.timers.size >= watcher.count) watcher.resolve();
			else this.watchers.push(watcher);
		}
		return () => this.timers.delete(id);
	}

	pending(): number {
		return this.timers.size;
	}

	/** Resolves once at least `count` timers are pending, as when a process elsewhere has scheduled one. */
	whenPending(count: number): Promise<void> {
		if (this.timers.size >= count) return Promise.resolve();
		return new Promise((resolve) => this.watchers.push({ count, resolve }));
	}

	/** Moves time on by `ms`, firing every timer that falls due, earliest first. */
	advance(ms: number): void {
		const until = this.time + ms;
		for (;;) {
			const due = [...this.timers].filter(([, timer]) => timer.at <= until).sort(([, a], [, b]) => a.at - b.at)[0];
			if (!due) break;
			this.timers.delete(due[0]);
			this.time = due[1].at;
			due[1].run();
		}
		this.time = until;
	}
}

/** Every log line, so a test can assert the core logged no error. */
export class RecordingLog implements CoreLog {
	readonly infos: string[] = [];
	readonly errors: string[] = [];
	info = (message: string): void => {
		this.infos.push(message);
	};
	error = (message: string): void => {
		this.errors.push(message);
	};
}

/** Resolves once every microtask the fake has queued has run: the fake's quiescence (contract §14). */
export function quiesce(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

type RequestType = ClientMessage["type"];
type RequestBody<T extends RequestType> = Omit<Extract<ClientMessage, { type: T }>, "requestId">;

export class TestClient {
	readonly messages: ServerMessage[] = [];
	readonly violations: string[] = [];
	readonly frameSizes: number[] = [];
	/** Every frame as the link carried it. */
	readonly frames: string[] = [];
	private readonly connection: CoreConnection;
	private counter = 0;

	constructor(
		core: BridgeCore,
		readonly name: string,
	) {
		this.connection = core.connect({ send: (frame) => this.take(frame) });
	}

	/** Sends a raw frame, valid or not, measured as the link would carry it. */
	sendFrame(frame: JsonValue): Promise<void> {
		return this.connection.receive(frame, Buffer.byteLength(JSON.stringify(frame), "utf8"));
	}

	/** A frame the connection's rate limit refused. */
	refuseFrame(frame: JsonValue): void {
		this.connection.refuse(frame);
	}

	async request<T extends RequestType>(
		type: T,
		body: Omit<RequestBody<T>, "type">,
	): Promise<ResponseFor<T> | ErrorResponse> {
		const requestId = `${this.name}-${this.counter++}`;
		const message: JsonValue = JSON.parse(JSON.stringify({ type, requestId, ...body }));
		await this.sendFrame({ type: "contract", message });
		const answers = this.messages.filter((item) => "requestId" in item && item.requestId === requestId);
		const [answer] = answers;
		if (answers.length !== 1 || !answer) throw new Error(`${type} got ${answers.length} answers`);
		if (!answersTo(type, answer)) throw new Error(`${type} was answered with ${answer.type}`);
		return answer;
	}

	/** A request that must succeed at the protocol level. */
	async ok<T extends RequestType>(type: T, body: Omit<RequestBody<T>, "type">): Promise<ResponseFor<T>> {
		const answer = await this.request(type, body);
		if (isProtocolError(answer)) throw new Error(`${type} failed: ${answer.error.code} ${answer.error.message}`);
		return answer;
	}

	/** Says `hello` as an app of `protocol`, the bridge's own by default. */
	hello(protocol: ProtocolVersion = PROTOCOL_VERSION): Promise<ResponseFor<"hello">> {
		return this.ok("hello", { protocol, client: { name: "test", version: "1.0.0" } });
	}

	envelopes(session?: SessionRef): EventEnvelope[] {
		return this.messages.flatMap((message) =>
			message.type === "event" &&
			(!session ||
				(message.envelope.session.sessionId === session.sessionId &&
					message.envelope.session.backend === session.backend))
				? [message.envelope]
				: [],
		);
	}

	events(session?: SessionRef): AgentEvent[] {
		return this.envelopes(session).map((envelope) => envelope.event);
	}

	catalog(): Extract<ServerMessage, { type: "catalog" }>[] {
		return this.messages.flatMap((message) => (message.type === "catalog" ? [message] : []));
	}

	clear(): void {
		this.messages.length = 0;
	}

	close(): void {
		this.connection.close();
	}

	private take(text: string): void {
		this.frameSizes.push(Buffer.byteLength(text, "utf8"));
		this.frames.push(text);
		const frame = JSON.parse(text);
		if (frame.type !== "contract") {
			this.violations.push(`a frame of type ${frame.type}`);
			return;
		}
		const parsed = ServerMessage.safeParse(frame.message);
		if (!parsed.success) {
			this.violations.push(parsed.error.message);
			return;
		}
		this.messages.push(parsed.data);
	}
}

export function isProtocolError(message: ServerMessage): message is ErrorResponse {
	return message.type === "error";
}

function answersTo<T extends RequestType>(type: T, message: ServerMessage): message is ResponseFor<T> | ErrorResponse {
	return message.type === `${type}.result` || message.type === "error";
}

export interface CoreRig {
	readonly core: BridgeCore;
	readonly fake: FakeBackend;
	/** The host the core gave the backend, for catalog news no fake control produces. */
	readonly host: BackendHost;
	readonly opens: OpenRecord;
	readonly clock: ManualClock;
	readonly log: RecordingLog;
	client(name: string, protocol?: ProtocolVersion): Promise<TestClient>;
}

export interface CoreRigOptions {
	readonly fake?: FakeBackendOptions;
	readonly core?: Partial<CoreOptions>;
	/** Changes the adapter the core gets, as a broken adapter would differ from the fake. */
	readonly adapt?: (backend: AgentBackend) => AgentBackend;
}

export const RIG_CWD = "/fake/project";

export function promptInput(
	text: string,
	mode: PromptMode = "start",
	clientRequestId = crypto.randomUUID(),
): PromptInput {
	return { clientRequestId, mode, text, attachments: [] };
}

/** Every way what `client` received for `session` after `initial` breaks the contract's stream rules. */
export function streamProblems(
	client: TestClient,
	session: SessionRef,
	traits: BackendTraits,
	initial: SessionSnapshot,
): string[] {
	const records = client.envelopes(session).map(({ at, event }) => ({ at, event }));
	return [...streamViolations(records, traits, initial), ...unsettledParts(records, initial)];
}

/** Attaches and returns the snapshot the client starts from. */
export async function attachForSnapshot(client: TestClient, session: SessionRef): Promise<SessionSnapshot> {
	const answer = await client.ok("session.attach", { session });
	if (answer.sync.kind !== "snapshot") throw new Error("a fresh attach must get a snapshot");
	return answer.sync.snapshot;
}

/** A core with one fake backend; `client` connects and says hello. */
export async function startCoreRig(options: CoreRigOptions = {}): Promise<CoreRig> {
	const clock = new ManualClock();
	const log = new RecordingLog();
	const core = new BridgeCore({
		bridgeVersion: "0.0.0-test",
		maxFrameBytes: 8 * 1024 * 1024,
		log,
		clock,
		directories: async (path) => path,
		...options.core,
	});
	let fake: FakeBackend | undefined;
	let backendHost: BackendHost | undefined;
	const opens: OpenRecord = { opened: [], closed: [] };
	const id = options.fake?.id ?? "pi";
	await core.addBackend(id, async (host) => {
		backendHost = host;
		fake = createFakeBackend(host, options.fake);
		const recorded = recordingOpens(fake, opens);
		return options.adapt ? options.adapt(recorded) : recorded;
	});
	if (!fake || !backendHost) throw new Error("the fake backend did not start");
	const started = fake;
	return {
		core,
		fake: started,
		host: backendHost,
		opens,
		clock,
		log,
		client: async (name, protocol) => {
			const client = new TestClient(core, name);
			await client.hello(protocol);
			return client;
		},
	};
}
