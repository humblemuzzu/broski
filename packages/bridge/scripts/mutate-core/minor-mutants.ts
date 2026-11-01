import { type Mutant, mutantsOf } from "./mutant";

/** Mutants of what a client of an older minor is told and sent instead (`minor-views`, the stand-ins). */
export const MINOR_MUTANTS: Mutant[] = [
	...mutantsOf("core/minor-views.ts", [
		{
			name: "minor views: an older client is offered the op it cannot send",
			find: "filter((op) => client.speaks(opAddedIn(descriptor.id, op)));",
			replace: "filter(() => true);",
		},
		{
			name: "minor views: an older client is offered a tree op",
			find: "read_tree: ADDED_IN_MINOR.treeOps,",
			replace: "read_tree: 0,",
		},
		{
			name: "minor views: an older client is offered the shell op",
			find: "run_shell: ADDED_IN_MINOR.shellOps,",
			replace: "run_shell: 0,",
		},
		{
			name: "minor views: an older client is offered a session control op",
			find: "system_prompt: ADDED_IN_MINOR.sessionControls,",
			replace: "system_prompt: 0,",
		},
		{
			name: "minor views: an older client is offered a 1.4 op",
			find: "config_files: ADDED_IN_MINOR.configOps,",
			replace: "config_files: 0,",
		},
		{
			name: "minor views: an older client is offered a kind that joined the backend later",
			find: "return Math.max(OP_ADDED_IN[op], OP_JOINED_IN[backend]?.[op] ?? 0);",
			replace: "return OP_ADDED_IN[op];",
		},
		{
			name: "minor views: an older client's attach snapshot keeps the plan approvals' modes",
			find: 'if (sync.kind !== "snapshot" || client.speaks(ADDED_IN_MINOR.configOps)) return sync;',
			replace: "return sync;",
		},
		{
			name: "minor views: an older client may answer with a mode",
			find: "if (client.speaks(ADDED_IN_MINOR.configOps) || reply.kind",
			replace: "if (true || reply.kind",
		},
		{
			name: "minor views: a client of 1.3 is sent the answer capability",
			find: "if (client.speaks(ADDED_IN_MINOR.watchedAnswers)) return capabilities;",
			replace: "return capabilities;",
		},
		{
			name: "minor views: a client of 1.4 is not told a watched session takes answers",
			find: "if (client.speaks(ADDED_IN_MINOR.watchedAnswers)) return capabilities;",
			replace: "",
		},
		{
			name: "minor views: an older client is sent capability fields it cannot read",
			find: "if (client.speaks(ADDED_IN_MINOR.sessionControls)) return before14;",
			replace: "return before14;",
		},
	]),
	...mutantsOf("core/older-events.ts", [
		{
			name: "older events: no stand-in for the returned input",
			find: 'if (before14.type === "input_returned") {',
			replace: "if (false) {",
		},
		{
			name: "older events: no stand-in for a prompt suggestion",
			find: 'return event.extension.kind === "prompt_suggestion"',
			replace: "return false",
		},
		{
			name: "older events: the stand-in can cut a surrogate pair",
			find: "return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;",
			replace: "return cut;",
		},
		{
			name: "older events: the stand-in is not cut to the contract's bound",
			find: "if (text.length <= MAX_TEXT_CHARS) return text;",
			replace: "return text;",
		},
		{
			name: "older events: every event gets a 1.4 stand-in",
			find: "if (before14 !== event || after14 !== after) {",
			replace: "if (true) {",
			equivalent:
				"speed only: the stand-in of an event 1.4 left unchanged encodes to the event's own frame, which is left out",
		},
		{
			name: "older events: a stand-in the same as the frame before it is kept",
			find: "if (fitted.text === newer) continue;",
			replace: "",
			equivalent: "memory only: a client given that stand-in receives the very text it would have received anyway",
		},
		{
			name: "older events: a plan approval keeps its modes in the event",
			find: "return interaction === event.interaction ? event : { ...event, interaction };",
			replace: "return event;",
		},
		{
			name: "older events: a resync keeps the plan approvals' modes",
			find: "return snapshot === event.snapshot ? event : { ...event, snapshot };",
			replace: "return event;",
		},
		{
			name: "older events: the state a fallback is built from keeps the modes",
			find: "const after14 = snapshotBefore14(after);",
			replace: "const after14 = after;",
		},
	]),
	...mutantsOf("core/older-plans.ts", [
		{
			name: "older plans: a plan approval keeps its modes",
			find: 'if (request.kind !== "plan_approval" || request.modeOptions === undefined) return interaction;',
			replace: "return interaction;",
		},
		{
			name: "older plans: a snapshot with nothing to take out is copied",
			find: "return interactions.every((interaction, index) => interaction === snapshot.interactions[index])",
			replace: "return false",
			equivalent:
				"speed only: the copy equals the snapshot, so every stand-in built from it encodes to the frame it stands in for and is left out",
		},
	]),
	...mutantsOf("core/client.ts", [
		{
			name: "client: the stand-in goes to a client that speaks the event",
			find: "while (sent.instead && !this.speaks(sent.instead.minor))",
			replace: "while (sent.instead)",
		},
		{
			name: "client: only the first stand-in is followed",
			find: "while (sent.instead && !this.speaks(sent.instead.minor)) sent",
			replace: "if (sent.instead && !this.speaks(sent.instead.minor)) sent",
		},
		{
			name: "client: the stand-in is never sent",
			find: "while (sent.instead && !this.speaks(sent.instead.minor))",
			replace: "while (false)",
		},
	]),
];
