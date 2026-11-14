import { type Mutant, mutantsOf } from "./mutant";

/** Mutants of what the core remembers about replaced sessions, and of telling a phone that was away. */
export const REPLACEMENT_MUTANTS: Mutant[] = [
	...mutantsOf("core/replacements.ts", [
		{
			name: "replacements: an expired record still answers",
			find: "return record && !expired(record, now) ? record : undefined;",
			replace: "return record;",
		},
		{
			name: "replacements: a record expires a moment early",
			find: "return now - record.at > REPLACEMENT_TTL_MS;",
			replace: "return now - record.at >= REPLACEMENT_TTL_MS;",
		},
		{ name: "replacements: nothing is written to the journal", find: "this.journal?.append(record);", replace: "" },
		{
			name: "replacements: the journal is not read",
			find: "for (const record of journal?.load() ?? []) this.byEpoch",
			replace: "for (const record of []) this.byEpoch",
		},
		{
			name: "replacements: a chain is not followed",
			find: "while (!visited.has(record.nextEpoch)) {",
			replace: "while (false) {",
		},
		{
			name: "replacements: a chain that loops is followed for ever",
			find: "while (!visited.has(record.nextEpoch)) {",
			replace: "while (true) {",
		},
		{
			name: "replacements: the memory has no bound",
			find: "maxEntries: REPLACEMENT_MEMORY,",
			replace: "maxEntries: Number.MAX_SAFE_INTEGER,",
		},
	]),
	...mutantsOf("core/session-hub.ts", [
		{
			name: "hub: a replacement is not remembered",
			find: "\t\tthis.deps.replacements.record(old.epoch, ref, next.epoch);\n",
			replace: "",
		},
		{
			name: "hub: a replacement does not name the stream that follows",
			find: "record(old.epoch, ref, next.epoch)",
			replace: "record(old.epoch, ref, old.epoch)",
		},
	]),
	...mutantsOf("core/attach-redirect.ts", [
		{
			name: "redirect: the stream is not looked up",
			find: "const session = ctx.replacements.successor(epoch);",
			replace: "const session = undefined;",
		},
		{
			name: "redirect: the answer names the stream that now holds the session",
			find: "epoch: moved.epoch, session: live.ref",
			replace: "epoch: live.epoch, session: live.ref",
		},
	]),
	...mutantsOf("core/requests-live.ts", [
		{
			name: "attach: a resumed stream that was replaced is attached",
			find: "const moved = movedTo(ctx, request.resume?.epoch);",
			replace: "const moved = undefined;",
		},
		{
			name: "attach: a replacement during the open is not told",
			find: "const moved = movedTo(ctx, live.epoch);",
			replace: "const moved = undefined;",
		},
	]),
	...mutantsOf("contract/forms.ts", [
		{
			name: "field key: __proto__ is a legal key",
			find: '.regex(/^(?!__proto__$)/, "a field key cannot be __proto__")',
			replace: '.regex(/^/, "a field key cannot be __proto__")',
		},
		{
			name: "field key: a key that merely starts with __proto__ is refused",
			find: ".regex(/^(?!__proto__$)/",
			replace: ".regex(/^(?!__proto__)/",
		},
	]),
	...mutantsOf("contract/interaction-replies.ts", [
		{
			name: "form reply: an answer keyed __proto__ arrives without the key",
			find: "values: withoutProtoKey.pipe(",
			replace: "values: z.any().pipe(",
		},
		{
			name: "form reply: any own key but __proto__ is refused",
			find: '!Object.hasOwn(values, "__proto__")',
			replace: "Object.keys(values).length === 0",
		},
	]),
	...mutantsOf("server/contract-seam.ts", [
		{
			name: "seam: replaced sessions are not kept across restarts",
			find: '\t\t\treplacementJournal: openReplacementJournal(join(journals, "replacements.jsonl"), log),\n',
			replace: "",
		},
	]),
];
