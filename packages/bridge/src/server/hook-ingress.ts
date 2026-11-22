/**
 * Where terminal agents' hooks post on the loopback listener: `POST /hook/<backend>` reaches that backend's receiver,
 * and `/cc-terminal-hook`, the path Claude Code's installed hook names, stays Claude Code's. Each receiver bounds its own
 * body; the hook token (never the bridge's) and the loopback check come first (`http-handler.ts`).
 */

import { type BackendId, BackendId as BackendIdSchema } from "../contract";

export type HookHandler = (request: Request) => Promise<Response>;

export interface HookIngress {
	/** The path is a hook's, registered or not. */
	owns(pathname: string): boolean;
	handle(request: Request): Promise<Response>;
}

const HOOK_PREFIX = "/hook/";
const CLAUDE_CODE_ALIAS = "/cc-terminal-hook";

export function createHookIngress(handlers: ReadonlyMap<BackendId, HookHandler>): HookIngress {
	return {
		owns: (pathname) => pathname === CLAUDE_CODE_ALIAS || pathname.startsWith(HOOK_PREFIX),
		handle: async (request) => {
			const pathname = new URL(request.url).pathname;
			const backend = pathname === CLAUDE_CODE_ALIAS ? "claude-code" : pathname.slice(HOOK_PREFIX.length);
			if (!BackendIdSchema.safeParse(backend).success) {
				return Response.json({ error: "Not a backend id" }, { status: 400 });
			}
			const handler = handlers.get(backend);
			return handler ? handler(request) : Response.json({ error: "No hook for this backend" }, { status: 404 });
		},
	};
}
