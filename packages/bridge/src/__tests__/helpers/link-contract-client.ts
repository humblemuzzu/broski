/**
 * A phone speaking the contract protocol to a real bridge over the broski-link unix socket, the way
 * the daemon carries it: every contract message in a `{"type":"contract","message":…}` frame.
 */

import {
	type ClientMessage,
	type ErrorResponse,
	type EventEnvelope,
	type JsonValue,
	PROTOCOL_VERSION,
	type ResponseFor,
	ServerMessage,
	type SessionRef,
} from "../../contract";
import { E2E_WAIT_MS } from "../e2e/harness";
import { connectUnixWs, type LinkFrame, type UnixWsClient } from "../link/unix-ws";
import { isProtocolError } from "./core-rig";

type RequestType = ClientMessage["type"];
type RequestBody<T extends RequestType> = Omit<Extract<ClientMessage, { type: T }>, "type" | "requestId">;

export class LinkContractClient {
	private counter = 0;

	constructor(
		readonly socket: UnixWsClient,
		private readonly name: string,
	) {}

	/** Every contract message received so far, each checked against the contract's schema. */
	messages(): ServerMessage[] {
		return this.socket
			.frames()
			.filter((frame) => frame.type === "contract")
			.map((frame) => ServerMessage.parse(frame.message));
	}

	/** The size each contract frame carrying a `type` message had on the wire. */
	frameSizes(type: ServerMessage["type"]): number[] {
		return this.socket.frames().flatMap((frame) => {
			if (frame.type !== "contract") return [];
			const message = ServerMessage.safeParse(frame.message);
			return message.success && message.data.type === type ? [Buffer.byteLength(JSON.stringify(frame), "utf8")] : [];
		});
	}

	/** Frames that are not contract frames; the bridge sends a client none. */
	foreignFrames(): LinkFrame[] {
		return this.socket.frames().filter((frame) => frame.type !== "contract");
	}

	envelopes(session: SessionRef): EventEnvelope[] {
		return this.messages().flatMap((message) =>
			message.type === "event" && message.envelope.session.sessionId === session.sessionId ? [message.envelope] : [],
		);
	}

	sendRaw(message: JsonValue): void {
		this.socket.send({ type: "contract", message });
	}

	async request<T extends RequestType>(type: T, body: RequestBody<T>): Promise<ResponseFor<T> | ErrorResponse> {
		const requestId = `${this.name}-${this.counter++}`;
		this.socket.send({ type: "contract", message: { type, requestId, ...body } });
		const frame = await this.socket.waitForWhere(
			(candidate) => candidate.type === "contract" && messageRequestId(candidate) === requestId,
			`${type} ${requestId}`,
			E2E_WAIT_MS,
		);
		const message = ServerMessage.parse(frame.message);
		if (!answersTo(type, message)) throw new Error(`${type} was answered with ${message.type}`);
		return message;
	}

	async ok<T extends RequestType>(type: T, body: RequestBody<T>): Promise<ResponseFor<T>> {
		const answer = await this.request(type, body);
		if (isProtocolError(answer)) throw new Error(`${type} failed: ${answer.error.code} ${answer.error.message}`);
		return answer;
	}

	hello(): Promise<ResponseFor<"hello">> {
		return this.ok("hello", { protocol: PROTOCOL_VERSION, client: { name: this.name, version: "1.0.0" } });
	}

	/** Resolves with the first contract message that `matches`, received or still to come. */
	async waitForMessage(
		matches: (message: ServerMessage) => boolean,
		label: string,
		timeoutMs = E2E_WAIT_MS,
	): Promise<ServerMessage> {
		const frame = await this.socket.waitForWhere(
			(candidate) => {
				if (candidate.type !== "contract") return false;
				const message = ServerMessage.safeParse(candidate.message);
				return message.success && matches(message.data);
			},
			label,
			timeoutMs,
		);
		return ServerMessage.parse(frame.message);
	}

	/** Resolves with the first event of `session` that `matches`, received or still to come. */
	async waitForEvent(
		session: SessionRef,
		matches: (envelope: EventEnvelope) => boolean,
		label: string,
		timeoutMs = E2E_WAIT_MS,
	): Promise<EventEnvelope> {
		const message = await this.waitForMessage(
			(candidate) =>
				candidate.type === "event" &&
				candidate.envelope.session.sessionId === session.sessionId &&
				matches(candidate.envelope),
			label,
			timeoutMs,
		);
		if (message.type !== "event") throw new Error("not an event");
		return message.envelope;
	}
}

/** The `requestId` of the contract message a frame carries, when it has one. */
export function messageRequestId(frame: LinkFrame): string | undefined {
	const message = frame.message;
	if (typeof message !== "object" || message === null || !("requestId" in message)) return undefined;
	return typeof message.requestId === "string" ? message.requestId : undefined;
}

function answersTo<T extends RequestType>(type: T, message: ServerMessage): message is ResponseFor<T> | ErrorResponse {
	return message.type === `${type}.result` || message.type === "error";
}

/** A new phone on the bridge's link socket, under its own device id. */
export async function connectPhone(socketPath: string, name: string): Promise<LinkContractClient> {
	const deviceId = crypto.randomUUID().replaceAll("-", "");
	const socket = await connectUnixWs(socketPath, {
		"x-broski-device-id": deviceId,
		"x-broski-device-name": name,
		"x-broski-role": "owner",
	});
	return new LinkContractClient(socket, name);
}
