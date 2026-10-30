import type { ClientMessage, ServerMessage } from "../types";
import type { ClientMessageOf, Handler, MessageRouter, MessageType, Reply, RequestContext } from "./types";

type InternalHandler = (message: ClientMessage, ctx: RequestContext) => Promise<void>;

export class RouteRegistry implements MessageRouter {
	private readonly handlers = new Map<MessageType, InternalHandler>();

	register<T extends MessageType>(type: T, handler: Handler<T>): void {
		if (this.handlers.has(type)) {
			throw new Error(`Duplicate handler registered for message type: ${type}`);
		}
		this.handlers.set(type, handler as InternalHandler);
	}

	has(type: string): boolean {
		return this.handlers.has(type as MessageType);
	}

	get(type: MessageType): InternalHandler | undefined {
		return this.handlers.get(type);
	}

	registeredTypes(): MessageType[] {
		return [...this.handlers.keys()];
	}

	size(): number {
		return this.handlers.size;
	}

	/** One map lookup, then one handler call. No sequential chain. */
	async dispatch(message: ClientMessage, ctx: RequestContext): Promise<void> {
		const handler = this.handlers.get(message.type);
		if (!handler) {
			ctx.reply(unknownTypeError(message.type));
			return;
		}
		await handler(message, ctx);
	}
}

/**
 * Preserves the pre-registry behaviour for a type no handler owns: `unified_`
 * messages reported a domain-specific error, everything else was funnelled
 * through the Claude Code router and landed on "Unknown message type".
 */
export function unknownTypeError(type: string): ServerMessage {
	if (type.startsWith("unified_")) return { type: "error", message: `Unhandled unified message: ${type}` };
	return { type: "error", message: "Unknown message type" };
}

/**
 * Registers one handler for every type in `types`. TypeScript checks that each
 * listed type is a real `ClientMessage` member and that the handler accepts the
 * message narrowed to the listed union.
 */
export function registerAll<T extends MessageType>(
	router: MessageRouter,
	types: readonly T[],
	handler: (message: ClientMessageOf<T>, ctx: RequestContext) => Promise<void>,
): void {
	for (const type of types) {
		router.register(type, handler);
	}
}

/** Handler shape shared by the pre-registry handler modules: `(message, reply, ctx)`. */
export type LegacyHandler<M, C> = (message: M, reply: Reply, ctx: C) => Promise<unknown>;

/**
 * Registers `handler` for every type in `types`, adapting the legacy
 * `(message, reply, ctx)` signature. `build` turns the per-message
 * `RequestContext` into the module-local context the handler expects.
 */
export function registerLegacy<T extends MessageType, C>(
	router: MessageRouter,
	types: readonly T[],
	handler: LegacyHandler<ClientMessageOf<T>, C>,
	build: (ctx: RequestContext) => C,
): void {
	registerAll(router, types, async (message, ctx) => {
		await handler(message, ctx.reply, build(ctx));
	});
}
