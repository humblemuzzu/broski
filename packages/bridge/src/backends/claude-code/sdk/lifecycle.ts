import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CommandLifecycle } from "../ports/sdk";

/** What every frame has, so a frame outside the declared union can be read without a cast. */
interface LooseFrame {
	readonly type: string;
	readonly command_uuid?: unknown;
	readonly state?: unknown;
}

/** The frame as a `command_lifecycle`, or undefined for every other frame. */
export function asCommandLifecycle(message: SDKMessage): CommandLifecycle | undefined {
	const frame: LooseFrame = message;
	if (frame.type !== "command_lifecycle") return undefined;
	const { command_uuid: commandUuid, state } = frame;
	if (typeof commandUuid !== "string" || typeof state !== "string") return undefined;
	return { type: "command_lifecycle", commandUuid, state };
}
