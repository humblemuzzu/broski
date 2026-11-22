import { type Mutant, mutantsOf } from "./mutant";

/** Mutants of where an answer goes: a phone's, one from outside the phones, and what answers a session. */
export const ANSWER_MUTANTS: Mutant[] = [
	...mutantsOf("core/bridge-answer.ts", [
		{
			name: "answer: a session that is not open is answered",
			find: 'if (!live) return rejected("not_found", "the session is not open");',
			replace: "",
		},
		{
			name: "answer: a session nothing answers is answered",
			find: "if (!answerer) return rejected(",
			replace: "if (false) return rejected(",
		},
		{
			name: "answer: a watched session that takes answers is refused",
			find: "answer.interactionId) ?? sessionAnswerer(live.open);",
			replace: "answer.interactionId) ?? live.open.control;",
		},
		{
			name: "answer: the deadline never gives up",
			find: "if (outcome === undefined) {",
			replace: "if (false) {",
		},
		{ name: "answer: a throwing adapter escapes", find: "if (!outcome.ok) {", replace: "if (false) {" },
		{
			name: "answer: the desk is bypassed",
			find: "settled(() => deps.desk.answer(live, answerer, answer))",
			replace: "settled(() => answerer.answer(answer))",
		},
	]),
	...mutantsOf("core/answering.ts", [
		{
			name: "phone answer: a session nothing answers is answered",
			find: "if (!answerer) return rejected(",
			replace: "if (false) return rejected(",
		},
		{
			name: "phone answer: a watched session that takes answers is refused",
			find: "live.open.control ?? sessionAnswerer(live.open)",
			replace: "live.open.control",
		},
		{
			name: "phone answer: the desk is bypassed",
			find: "ctx.desk.answer(live, answerer, request.answer)",
			replace: "answerer.answer(request.answer)",
		},
	]),
	...mutantsOf("contract/backend.ts", [
		{
			name: "answerer: a session with control has none",
			find: "\tif (session.control) return session.control;\n",
			replace: "",
		},
		{
			name: "answerer: a watched session's own answer is ignored",
			find: "\treturn session.answer !== undefined;",
			replace: "\treturn false;",
		},
		{
			name: "capabilities: a watched session that takes answers says it does not",
			find: "answer: sessionAnswerer(session) !== undefined,",
			replace: "answer: session.control !== undefined,",
		},
	]),
];
