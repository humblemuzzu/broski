/**
 * A `ClaudeSdk` (`ports/sdk.ts`) for unit tests: every session function answers from `overrides` or with the SDK's
 * empty answer, and `query` hands out the `FakeQuery` a test scripts. Real-CLI tests use `createClaudeSdk` instead.
 */

import { filterEscalatingDefaultMode, type ResolvedSettings } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeSdk, QueryParams, SessionFunctions } from "../../../backends/claude-code/ports";
import { FakeQuery } from "./fake-query";

export interface FakeClaudeSdkOptions {
	readonly overrides?: Partial<SessionFunctions>;
	/** Each `query()` call gets the next one; past the end, a new idle `FakeQuery`. */
	readonly queries?: FakeQuery[];
	readonly configRoot?: string;
}

export interface FakeClaudeSdk extends ClaudeSdk {
	/** Every `query()` call's params, in order. */
	readonly started: QueryParams[];
	readonly disposed: () => boolean;
}

const EMPTY_SETTINGS: ResolvedSettings = { effective: {}, provenance: {}, sources: [] };

function defaults(): SessionFunctions {
	return {
		listSessions: async () => [],
		getSessionInfo: async () => undefined,
		getSessionMessages: async () => [],
		getSubagentMessages: async () => [],
		listSubagents: async () => [],
		forkSession: async (sessionId) => Promise.reject(new Error(`Session ${sessionId} not found`)),
		renameSession: async (sessionId) => Promise.reject(new Error(`Session ${sessionId} not found`)),
		resolveSettings: async () => EMPTY_SETTINGS,
	};
}

export function fakeClaudeSdk(options: FakeClaudeSdkOptions = {}): FakeClaudeSdk {
	const fns: SessionFunctions = { ...defaults(), ...options.overrides };
	const queries = [...(options.queries ?? [])];
	const started: QueryParams[] = [];
	let disposed = false;
	return {
		...fns,
		query: (params) => {
			started.push(params);
			return queries.shift() ?? new FakeQuery();
		},
		filterEscalatingDefaultMode: (resolved) => filterEscalatingDefaultMode(resolved),
		configRoot: () => options.configRoot ?? "/nonexistent/fake-claude-config",
		dispose: async () => {
			disposed = true;
		},
		started,
		disposed: () => disposed,
	};
}
