import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type InterruptOptions = { cancelQueued?: boolean };
type InterruptWithOptions = (options?: InterruptOptions) => ReturnType<Query["interrupt"]>;

/**
 * `Query.interrupt` with the `{cancelQueued}` argument the runtime takes (`sdk.mjs` `async interrupt(e)`) but
 * `sdk.d.ts` does not declare (`interrupt(): Promise<…>`); a zero-parameter method is assignable to this type.
 */
export function interruptQuery(q: Query, options?: InterruptOptions): ReturnType<Query["interrupt"]> {
	const interrupt: InterruptWithOptions = q.interrupt.bind(q);
	return interrupt(options);
}

export type LifecycleFrame = { command_uuid: string; state: string };

/** The untyped `command_lifecycle` frames (`sdk.d.ts` has no type for them; `sdk.mjs` passes them through). */
export function lifecycleFrames(messages: readonly SDKMessage[]): LifecycleFrame[] {
	return messages.flatMap((message) => {
		const raw: { type: string; command_uuid?: unknown; state?: unknown } = message;
		return raw.type === "command_lifecycle" && typeof raw.command_uuid === "string"
			? [{ command_uuid: raw.command_uuid, state: String(raw.state) }]
			: [];
	});
}

export function statesOf(messages: readonly SDKMessage[], commandUuid: string): string[] {
	return lifecycleFrames(messages)
		.filter((frame) => frame.command_uuid === commandUuid)
		.map((frame) => frame.state);
}
