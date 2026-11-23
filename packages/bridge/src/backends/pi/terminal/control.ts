/**
 * What the phone may do to a session a terminal runs, through the terminal's own `pi` and no other writer: send a
 * message (start, steer or queue, as the terminal's session takes it), answer what the terminal asks (`dialogs.ts`),
 * change model and thinking level, trigger compaction (extension v10+), and stop the run. Stop is the terminal's Esc:
 * Pi's extension `ctx.abort()` is bound by the interactive mode to `restoreQueuedMessagesToEditor({ abort: true })`
 * (pi-coding-agent `src/modes/interactive/interactive-mode.ts:1978-1981`), so what was queued goes back into the
 * terminal's editor, not to the phone. Permissions mode stays terminal-only (the host permission gate does not run there).
 */

import type {
	ActionResult,
	ClientRequestId,
	ImageRef,
	ModelId,
	PromptInput,
	PromptResult,
	SessionControl,
} from "../../../contract";
import { commandText, parseCommandId } from "../command-ids";
import type { LiveImageCache } from "../live/image-cache";
import type { ModelCatalogue } from "../models/catalogue";
import { supportedLevel } from "../models/thinking";
import { ACCEPTED, rejected } from "../rejections";
import type { CommandAnswer } from "./protocol";
import type { TerminalSession } from "./registry";

/** Accepted prompts remembered, as a hosted session remembers them (`PromptDesk`). */
const REMEMBERED_PROMPTS = 1_000;
/** First `broski-link` version that handles `set_model`, `set_thinking` and `compact` without falling through to prompt. */
const CONTROLS_EXTENSION_VERSION = 10;
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

const IN_THE_TERMINAL = "Change it in the terminal that runs this session.";
const RELOAD_TERMINAL = "Change it in the terminal, or run /reload there to enable it from your phone.";

export interface TerminalControlDeps {
	readonly models?: Pick<ModelCatalogue, "find" | "missing">;
	readonly imageCache?: LiveImageCache;
}

function refusal(answer: Extract<CommandAnswer, { ok: false }>) {
	return rejected(answer.code, answer.message);
}

function problem(input: PromptInput) {
	if (input.attachments.some((attachment) => attachment.kind !== "image")) {
		return rejected("unsupported", "A terminal session takes images, not files.");
	}
	if (input.attachments.length === 0 && input.command === undefined && input.text.trim() === "") {
		return rejected("invalid_input", "the prompt is empty");
	}
	if (input.command !== undefined && parseCommandId(input.command) === undefined) {
		return rejected("not_found", `no command ${input.command}`);
	}
	return undefined;
}

async function setTerminalModel(
	session: TerminalSession,
	models: Pick<ModelCatalogue, "find" | "missing"> | undefined,
	modelId: ModelId,
): Promise<ActionResult> {
	if (session.extensionVersion < CONTROLS_EXTENSION_VERSION) return rejected("unsupported", RELOAD_TERMINAL);
	if (models === undefined) return rejected("unsupported", IN_THE_TERMINAL);
	const model = await models.find(modelId, session.cwd);
	if (!model) return models.missing(modelId);
	const answer = await session.command({ kind: "set_model", provider: model.provider, id: model.id });
	return answer.ok ? ACCEPTED : refusal(answer);
}

async function setTerminalThinking(
	session: TerminalSession,
	models: Pick<ModelCatalogue, "find" | "missing"> | undefined,
	value: string,
): Promise<ActionResult> {
	if (session.extensionVersion < CONTROLS_EXTENSION_VERSION) return rejected("unsupported", RELOAD_TERMINAL);
	const modelId = session.feed.snapshot().modelId;
	if (modelId === undefined) return rejected("no_model", "the session has no model to set thinking on");
	const model = models === undefined ? undefined : await models.find(modelId, session.cwd);
	const level = model !== undefined ? supportedLevel(model, value) : THINKING_LEVELS.has(value) ? value : undefined;
	if (level === undefined) return rejected("invalid_input", `the model offers no thinking level ${value}`);
	const answer = await session.command({ kind: "set_thinking", level });
	return answer.ok ? ACCEPTED : refusal(answer);
}

async function compactTerminal(session: TerminalSession, instructions: string | undefined): Promise<ActionResult> {
	const snapshot = session.feed.snapshot();
	if (snapshot.run !== undefined || snapshot.compaction !== undefined) {
		return rejected("busy", "compaction needs a session with no run under way");
	}
	if (snapshot.modelId === undefined) return rejected("no_model", "the session has no model to compact with");
	const answer = await session.command({
		kind: "compact",
		...(instructions !== undefined && instructions.length > 0 && { instructions }),
	});
	return answer.ok ? ACCEPTED : refusal(answer);
}

export function terminalControl(session: TerminalSession, deps: TerminalControlDeps = {}): SessionControl {
	const { models, imageCache } = deps;
	const accepted = new Map<ClientRequestId, PromptResult>();
	const remember = (id: ClientRequestId, result: PromptResult): void => {
		accepted.set(id, result);
		if (accepted.size > REMEMBERED_PROMPTS) {
			const oldest = accepted.keys().next();
			if (!oldest.done) accepted.delete(oldest.value);
		}
	};
	return {
		prompt: async (input) => {
			const known = accepted.get(input.clientRequestId);
			if (known) return known;
			const refused = problem(input);
			if (refused) return refused;
			const ref = input.command === undefined ? undefined : parseCommandId(input.command);
			const text = ref === undefined ? input.text : commandText(ref, input.text);
			const images = input.attachments.flatMap((attachment) => (attachment.kind === "image" ? [attachment] : []));
			const imageRefs: ImageRef[] = images.map((image, index) => {
				const id = `live:${input.clientRequestId}:${index}`;
				imageCache?.put(session.sessionId, id, {
					mimeType: image.mimeType,
					data: image.data,
					...(image.name !== undefined && { name: image.name }),
				});
				return {
					kind: "image_ref",
					id,
					mimeType: image.mimeType,
					...(image.name !== undefined && { name: image.name }),
				};
			});
			session.feed.sent.add(input.clientRequestId, text, input.mode === "start", imageRefs);
			const answer = await session.command({
				kind: "prompt",
				mode: input.mode,
				text,
				expand: ref !== undefined,
				images: images.map((image) => ({ mimeType: image.mimeType, data: image.data })),
			});
			if (!answer.ok) {
				session.feed.sent.forget(input.clientRequestId);
				return refusal(answer);
			}
			const result: PromptResult = {
				status: "accepted",
				disposition:
					answer.disposition === "started" || answer.disposition === "steered" || answer.disposition === "queued"
						? answer.disposition
						: "handled",
			};
			remember(input.clientRequestId, result);
			return result;
		},
		abort: async (): Promise<ActionResult> => {
			const answer = await session.command({ kind: "abort" });
			return answer.ok ? ACCEPTED : refusal(answer);
		},
		answer: async (answer) => session.feed.dialogs.answer(answer),
		setModel: (modelId) => setTerminalModel(session, models, modelId),
		setThinking: (value) => setTerminalThinking(session, models, value),
		setMode: async () => rejected("unsupported", IN_THE_TERMINAL),
		...(session.extensionVersion >= CONTROLS_EXTENSION_VERSION && {
			compact: (instructions: string | undefined) => compactTerminal(session, instructions),
		}),
	};
}
