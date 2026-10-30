import * as ccChat from "../handlers/cc_chat";
import * as ccElicitation from "../handlers/cc_elicitation";
import * as ccRouting from "../handlers/cc_routing";
import * as cxRouting from "../handlers/cx_routing";
import * as devices from "../handlers/devices";
import * as git from "../handlers/git/index";
import * as misc from "../handlers/misc";
import * as ocRouting from "../handlers/oc_routing";
import * as sessionView from "../handlers/session_view";
import * as unified from "../handlers/unified";
import * as unifiedChildren from "../handlers/unified_session_children";
import type { ClientMessage } from "../types";
import { RouteRegistry, registerAll, unknownTypeError } from "./registry";
import type { ServerDeps } from "./types";

const PTY_OPS = [
	"list_pty",
	"create_pty",
	"get_pty",
	"update_pty",
	"delete_pty",
	"pty_connect",
	"pty_input",
	"pty_disconnect",
	"pty_resize",
] as const;

/** Handled by the dispatcher itself, before the registry is consulted. */
const CORE_OPS = ["batch"] as const;

/**
 * Every message type the bridge registers, assembled from the modules that own
 * each group. Runtime duplicate detection plus the two type-level assertions
 * below prove a 1:1 mapping between `ClientMessage` members and handlers.
 */
export const ALL_MESSAGE_TYPES = [
	...ccChat.MODULE_TYPES,
	...ccElicitation.MODULE_TYPES,
	...ccRouting.MODULE_TYPES,
	...cxRouting.MODULE_TYPES,
	...devices.MODULE_TYPES,
	...git.MODULE_TYPES,
	...misc.MODULE_TYPES,
	...ocRouting.MODULE_TYPES,
	...sessionView.MODULE_TYPES,
	...unified.MODULE_TYPES,
	...unifiedChildren.MODULE_TYPES,
	...PTY_OPS,
	...CORE_OPS,
] as const;

type AssertNever<T extends never> = T;

/** A `ClientMessage` member with no owner makes this resolve to a non-`never` union and fails typecheck. */
export type MissingMessageHandler = AssertNever<Exclude<ClientMessage["type"], (typeof ALL_MESSAGE_TYPES)[number]>>;

/** An owned type that is not a `ClientMessage` member fails typecheck the same way. */
export type UnknownMessageHandler = AssertNever<Exclude<(typeof ALL_MESSAGE_TYPES)[number], ClientMessage["type"]>>;

/**
 * Builds the single type→handler map. Every `ClientMessage` type is registered
 * exactly once; a duplicate registration throws at startup.
 */
export function createMessageRegistry(deps: ServerDeps): RouteRegistry {
	const router = new RouteRegistry();

	ccChat.register(router, deps);
	ccElicitation.register(router, deps);
	ccRouting.register(router, deps);
	cxRouting.register(router, deps);
	devices.register(router, deps);
	git.register(router, deps);
	misc.register(router, deps);
	ocRouting.register(router, deps);
	sessionView.register(router, deps);
	unified.register(router, deps);
	unifiedChildren.register(router, deps);

	registerAll(router, PTY_OPS, async (message, ctx) => {
		await deps.ptyRuntime.handleMessage(ctx.ws, message, ctx.reply);
	});

	// `batch` is intercepted before dispatch; a nested batch reaches the registry
	// and must keep the "Unknown message type" reply it got from the old chain.
	registerAll(router, CORE_OPS, async (_message, ctx) => {
		ctx.reply(unknownTypeError("batch"));
	});

	return router;
}
