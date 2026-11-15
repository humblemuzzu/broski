import { z } from "zod";
import { ClientMessage, clip, type JsonValue, MAX_MESSAGE_BYTES, RequestId, ServerMessage } from "../contract";
import type { CoreClient } from "./client";
import type { CoreContext } from "./context";
import { encodeFrame, framedMessage } from "./frame";
import { shapeProblem } from "./message-shape";
import { routeRequest } from "./request-routes";
import { HELLO_FIRST, protocolError } from "./results";
import { fitMessage } from "./wire-fit";

/** How much of a validation report an `invalid_message` error carries. */
const MAX_REPORT_CHARS = 4_096;
const MAX_REPORTED_ISSUES = 16;

/**
 * How long a request may take before the bridge answers it `internal` itself: every request gets
 * its one answer even from an adapter whose call never settles. Longer than any wait of the core's
 * own (a backend still starting, a session still closing, then opening).
 */
export const REQUEST_DEADLINE_MS = 120_000;

/**
 * The wire boundary: every frame is checked against the contract's schemas before anything acts on
 * it, and every answer is checked and made to fit the link before it leaves. Each request gets
 * exactly one answer.
 */
export class ProtocolServer {
	constructor(private readonly ctx: CoreContext) {}

	/** One frame from `client`, `bytes` long in UTF-8. */
	async receive(client: CoreClient, frame: JsonValue, bytes: number): Promise<void> {
		const message = framedMessage(frame);
		if (message === undefined) {
			const text = 'a contract frame is {"type":"contract","message":…} and nothing else';
			this.deliver(client, protocolError(undefined, "invalid_message", text), undefined);
			return;
		}
		const requestId = readableRequestId(message);
		const problem =
			bytes > MAX_MESSAGE_BYTES ? `the frame is ${bytes} bytes; at most ${MAX_MESSAGE_BYTES}` : shapeProblem(message);
		if (problem !== undefined) {
			this.deliver(client, protocolError(requestId, "invalid_message", problem), requestId);
			return;
		}
		const parsed = ClientMessage.safeParse(message);
		if (!parsed.success) {
			this.deliver(client, protocolError(requestId, "invalid_message", report(parsed.error)), requestId);
			return;
		}
		await this.serve(client, parsed.data);
	}

	/** A frame the connection's rate limit refused: answered `rate_limited`, and nothing else is done. */
	refuse(client: CoreClient, frame: JsonValue): void {
		const message = framedMessage(frame);
		const requestId = message === undefined ? undefined : readableRequestId(message);
		const text = "too many messages on this connection; send it again in a few seconds";
		this.deliver(client, protocolError(requestId, "rate_limited", text), requestId);
	}

	private async serve(client: CoreClient, request: ClientMessage): Promise<void> {
		const { requestId, type } = request;
		if (type !== "hello" && !client.negotiated) {
			this.deliver(client, protocolError(requestId, "invalid_message", HELLO_FIRST), requestId);
			return;
		}
		const named = `${type} ${JSON.stringify(requestId)}`;
		let answered = false;
		const respond = (message: ServerMessage): boolean => {
			if (answered) {
				this.ctx.log.error(`[core] ${named} was answered already; its ${message.type} is dropped`);
				return false;
			}
			answered = true;
			return this.deliver(client, message, requestId);
		};
		const cancel = this.ctx.clock.after(REQUEST_DEADLINE_MS, () => {
			this.ctx.log.error(`[core] ${named} did not finish within ${REQUEST_DEADLINE_MS} ms`);
			respond(
				protocolError(requestId, "internal", `the bridge did not finish ${type} within ${REQUEST_DEADLINE_MS} ms`),
			);
		});
		try {
			await routeRequest(this.ctx, client, request, respond);
		} catch (error) {
			// An adapter threw, which the contract calls a bug: the request still gets its one answer.
			this.ctx.log.error(`[core] ${named} failed: ${String(error)}`);
			if (!answered) respond(protocolError(requestId, "internal", `the bridge failed to serve ${type}`));
		} finally {
			cancel();
		}
	}

	/** Sends `message`, or an `internal` error in its place when it breaks the contract or cannot fit the link. */
	private deliver(client: CoreClient, message: ServerMessage, requestId: string | undefined): boolean {
		const checked = ServerMessage.safeParse(message);
		if (!checked.success) {
			this.ctx.log.error(`[core] an answer breaks the contract: ${report(checked.error)}`);
			client.send(
				encodeFrame(protocolError(requestId, "internal", "the bridge built an answer that breaks the contract")),
			);
			return false;
		}
		const frame = fitMessage(message, this.ctx.maxFrameBytes, this.ctx.log);
		if (frame) {
			client.send(frame);
			return true;
		}
		const bytes = encodeFrame(message).bytes;
		this.ctx.log.error(`[core] a ${message.type} of ${bytes} bytes does not fit the link (${this.ctx.maxFrameBytes})`);
		const text = `the answer is ${bytes} bytes; the link carries at most ${this.ctx.maxFrameBytes}`;
		client.send(encodeFrame(protocolError(requestId, "internal", text)));
		return false;
	}
}

function report(error: z.ZodError): string {
	return clip(z.prettifyError(new z.ZodError(error.issues.slice(0, MAX_REPORTED_ISSUES))), MAX_REPORT_CHARS);
}

/** The `requestId` of a message that failed validation, when it carried one the bridge can read. */
function readableRequestId(message: JsonValue): string | undefined {
	if (message === null || typeof message !== "object" || Array.isArray(message)) return undefined;
	const parsed = RequestId.safeParse(message.requestId);
	return parsed.success ? parsed.data : undefined;
}
