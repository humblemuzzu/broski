/**
 * One-off probe for Q13's refusal fallback: two scripted refusals with `refusal_fallback_prompt` declared,
 * under a given model and env. Prints the dialogs, the refusal frames and the model of each request.
 * Run: `bun scripts/cc-spike/probe-refusal-fallback.ts [model] [--fable]`.
 */
import { frameLabel, startSpike } from "../../src/__tests__/claude-code/spike/rig/session";

const REFUSAL = { text: ["I can't help with that."], stopReason: "refusal" as const };
const model = process.argv[2]?.startsWith("--") ? undefined : process.argv[2];
const env = process.argv.includes("--fable")
	? { ANTHROPIC_DEFAULT_FABLE_MODEL: "claude-fable-1", ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-8" }
	: {};
const dialogs: unknown[] = [];
const spike = startSpike({
	permissionMode: "default",
	env,
	turns: [REFUSAL, REFUSAL, { text: ["answered by "], echoModel: true }, { text: ["spare "], echoModel: true }],
	options: {
		...(model ? { model } : {}),
		supportedDialogKinds: ["refusal_fallback_prompt"],
		onUserDialog: async (request) => {
			dialogs.push(request);
			return { behavior: "completed", result: "retry_fallback" };
		},
	},
});
try {
	spike.send("something bad");
	await spike.waitFor((m) => m.type === "result", { timeoutMs: 20_000 });
	await Bun.sleep(500);
	console.log(spike.messages.filter((m) => m.type !== "stream_event").map(frameLabel).join(" "));
	console.log("dialogs", JSON.stringify(dialogs));
	console.log("models", JSON.stringify(spike.server.mainRequests().map((r) => (r.body as { model: string }).model)));
	for (const m of spike.messages)
		if (m.type === "system" && m.subtype.startsWith("model_refusal")) console.log(JSON.stringify(m));
	const init = spike.messages.find((m) => m.type === "system" && m.subtype === "init");
	console.log("init model", init && "model" in init ? init.model : "?");
	console.log("result", JSON.stringify(spike.results().map((r) => [r.subtype, r.stop_reason, r.is_error])));
} finally {
	await spike.close();
}
