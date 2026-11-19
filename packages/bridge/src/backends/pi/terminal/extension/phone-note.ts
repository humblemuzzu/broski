import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** The section the bridge's own extension puts in the system prompt of a session the phone starts. */
const PHONE_SECTION = "broski_phone";

/**
 * The phone's note as the session recorded it, unwrapped from the `<broski_phone>\n…\n</broski_phone>` Pi stores
 * (pi-coding-agent 1.5.2 `dist/core/system-prompt.js:114-118`), or undefined when the session has none.
 */
function recordedNote(ctx: ExtensionContext): string | undefined {
	const system = ctx.sessionManager
		.getBranch()
		.flatMap((entry) => (entry.type === "message" && entry.message.role === "system" ? [entry.message] : []));
	const rendered = getCurrentSystemMessage(system)?.sections?.[PHONE_SECTION];
	const open = `<${PHONE_SECTION}>\n`;
	const close = `\n</${PHONE_SECTION}>`;
	if (typeof rendered !== "string" || !rendered.startsWith(open) || !rendered.endsWith(close)) return undefined;
	return rendered.slice(open.length, -close.length);
}

/**
 * A session the phone started goes on here with the note it was started with. Without it this `pi` would send a
 * changed system prompt, and the provider would read the whole cached conversation again.
 */
export function keepPhoneNote(sections: Record<string, string>, ctx: ExtensionContext): void {
	if (sections[PHONE_SECTION] !== undefined) return;
	const note = recordedNote(ctx);
	if (note !== undefined) sections[PHONE_SECTION] = note;
}
