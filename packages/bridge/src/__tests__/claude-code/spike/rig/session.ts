/**
 * One real `claude` process for a spike scenario: the scripted endpoint, a throwaway home, an open inbox
 * and exactly one consumer loop that records every SDK message. `close()` must run in `finally`.
 */

import { randomUUID } from "node:crypto";
import { type Options, type Query, query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { type ClaudeHome, claudeTestEnv, createClaudeHome } from "../../../helpers/claude-home";
import {
	type ScriptedAnthropic,
	type ScriptedAnthropicOptions,
	type ScriptedTurn,
	serveScriptedAnthropic,
} from "../../../helpers/scripted-anthropic-server";
import { recordFrames } from "./frames";
import { createInbox } from "./inbox";

export type SpikeOptions = {
	turns: ScriptedTurn[];
	permissionMode: NonNullable<Options["permissionMode"]>;
	server?: ScriptedAnthropicOptions;
	options?: Omit<Options, "permissionMode" | "env" | "cwd">;
	env?: Record<string, string | undefined>;
	git?: boolean;
	/** Reuse a home (resume and fork scenarios); the caller then owns its cleanup. */
	home?: ClaudeHome;
};

export type SpikeSession = {
	q: Query;
	server: ScriptedAnthropic;
	home: ClaudeHome;
	messages: SDKMessage[];
	stderr: string[];
	send: (content: SDKUserMessage["message"]["content"], extra?: Partial<SDKUserMessage>) => string;
	waitFor: (match: (message: SDKMessage) => boolean, options?: WaitOptions) => Promise<SDKMessage>;
	results: () => Extract<SDKMessage, { type: "result" }>[];
	record: (scenario: string) => void;
	close: () => Promise<void>;
};

export type WaitOptions = { timeoutMs?: number; after?: number };

/**
 * The host options (adapter README D5) that matter to the frames; `canUseTool` allows by default and tests replace it.
 */
export const SPIKE_DEFAULTS: Omit<Options, "permissionMode"> = {
	includePartialMessages: true,
	forwardSubagentText: true,
	enableFileCheckpointing: true,
	systemPrompt: { type: "preset", preset: "claude_code" },
	canUseTool: async (_tool, input) => ({ behavior: "allow", updatedInput: input }),
};

function userMessage(content: SDKUserMessage["message"]["content"], extra: Partial<SDKUserMessage>): SDKUserMessage {
	return {
		type: "user",
		message: { role: "user", content },
		parent_tool_use_id: null,
		origin: { kind: "human" },
		uuid: randomUUID(),
		...extra,
	};
}

function waiter(messages: SDKMessage[], ended: () => Error | null) {
	const listeners = new Set<() => void>();
	const wake = () => {
		for (const listener of listeners) listener();
	};
	const waitFor = (match: (message: SDKMessage) => boolean, options: WaitOptions = {}) =>
		new Promise<SDKMessage>((resolve, reject) => {
			const check = () => {
				const found = messages.slice(options.after ?? 0).find(match);
				if (found) return done(() => resolve(found));
				const error = ended();
				if (error) done(() => reject(error));
			};
			const timer = setTimeout(
				() => done(() => reject(new Error(`timed out; got ${messages.map(frameLabel).join(", ")}`))),
				options.timeoutMs ?? 15_000,
			);
			const done = (settle: () => void) => {
				clearTimeout(timer);
				listeners.delete(check);
				settle();
			};
			listeners.add(check);
			check();
		});
	return { wake, waitFor };
}

export function frameLabel(message: SDKMessage): string {
	if (message.type === "system") return `system/${message.subtype}${"state" in message ? `(${message.state})` : ""}`;
	if (message.type === "result") return `result/${message.subtype}`;
	if (message.type === "stream_event") return `stream/${message.event.type}`;
	return message.type;
}

export function startSpike(spec: SpikeOptions): SpikeSession {
	const server = serveScriptedAnthropic(spec.turns, spec.server);
	const home = spec.home ?? createClaudeHome({ git: spec.git });
	const inbox = createInbox();
	const messages: SDKMessage[] = [];
	const stderr: string[] = [];
	let endError: Error | null = null;
	const { wake, waitFor } = waiter(messages, () => endError);
	const q = query({
		prompt: inbox.iterable,
		options: {
			...SPIKE_DEFAULTS,
			...spec.options,
			permissionMode: spec.permissionMode,
			cwd: home.projectDir,
			env: { ...claudeTestEnv({ url: server.url, home, proxy: server.proxyUrl }), ...spec.env },
			stderr: (line) => stderr.push(line),
		},
	});
	const consumer = (async () => {
		try {
			for await (const message of q) {
				messages.push(message);
				wake();
			}
			endError = new Error("query ended");
		} catch (error) {
			endError = error instanceof Error ? error : new Error(String(error));
		}
		wake();
	})();
	return {
		q,
		server,
		home,
		messages,
		stderr,
		send: (content, extra = {}) => {
			const message = userMessage(content, extra);
			inbox.push(message);
			return message.uuid ?? "";
		},
		waitFor,
		results: () => messages.filter((m): m is Extract<SDKMessage, { type: "result" }> => m.type === "result"),
		record: (scenario) => recordFrames(scenario, messages, home.root),
		close: async () => {
			inbox.end();
			q.close();
			await Promise.race([consumer, Bun.sleep(10_000)]);
			server.stop();
			if (!spec.home) home.cleanup();
		},
	};
}

export function isIdle(message: SDKMessage): boolean {
	return message.type === "system" && message.subtype === "session_state_changed" && message.state === "idle";
}
