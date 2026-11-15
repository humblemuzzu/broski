import { type Mutant, mutantsOf } from "./mutant";

/** Mutants of the core's workspace rules: terminal output only to its viewers, attaches, and answers fitted by size. */
export const WORKSPACE_MUTANTS: Mutant[] = [
	...mutantsOf("core/terminal-viewers.ts", [
		{
			name: "terminal: an exited terminal keeps its viewers",
			find: 'if (event.type === "term_exited") this.forget(event.id);',
			replace: "",
		},
		{
			name: "terminal: a detach leaves the client counted as attached",
			find: "\t\tclient.terminals.delete(id);\n\t\tif (viewers.size === 0)",
			replace: "\t\tif (viewers.size === 0)",
		},
		{
			name: "terminal: an event that breaks the contract is sent",
			find: "if (!checked.success) {",
			replace: "if (false) {",
		},
		{
			name: "terminal: a client that leaves stays a viewer",
			find: "for (const id of [...client.terminals]) this.detach(id, client);",
			replace: "",
		},
	]),
	...mutantsOf("core/requests-terminal.ts", [
		{
			name: "terminal attach: an exited terminal is viewed",
			find: 'result.status === "accepted" && result.terminal.status === "running"',
			replace: 'result.status === "accepted"',
		},
		{
			name: "terminal attach: a replay that did not reach the client still attaches it",
			find: "if (sent && result.status",
			replace: "if (result.status",
		},
		{
			name: "terminal input: a client that is not attached is served",
			find: "else if (client.terminals.has(request.id))",
			replace: "else if (true)",
		},
	]),
	...mutantsOf("core/requests-catalog.ts", [
		{
			name: "hello: a client of another major keeps its terminals",
			find: "\t\tctx.terminals.leave(client);\n",
			replace: "",
		},
	]),
	...mutantsOf("core/core.ts", [
		{
			name: "core: a closed connection stays a terminal viewer",
			find: "\t\t\t\tthis.terminals.leave(client);\n",
			replace: "",
			equivalent:
				"memory only, until the terminal exits: a closed client is sent nothing (CoreClient.connected), so what it would view is never seen",
		},
	]),
	...mutantsOf("core/workspace-handler.ts", [
		{
			name: "workspace: an answer too large for the link is not read again smaller",
			find: "await pageWithinFrame(ctx.maxFrameBytes, initial(request), async (size) =>\n\t\t\t\tanswer(request, await run(target, size)),\n\t\t\t),",
			replace: "answer(request, await run(target, initial(request))),",
		},
	]),
];
