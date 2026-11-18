/**
 * Claude Code in the bridge: the adapter registered with the core, and the terminal hook's receiver
 * served while `claudeCode.terminalAsks` is on, so a terminal `claude`'s permission prompt reaches the phone.
 */

import type { BackendFactory, SessionRef } from "../contract";
import { createTerminalHookReceiver, type TerminalHookReceiver } from "./cc-terminal-hook";
import type { ClaudeCliPath } from "./claude-cli-path";
import { claudeCodeBackend } from "./claude-code-backend";
import type { ContractSeam } from "./contract-seam";

export interface ClaudeCodeSettings {
	readonly terminalAsks: boolean;
}

export interface ClaudeCodeWiring {
	/** Our `PermissionRequest` hook is installed (else removed). */
	readonly terminalAsks: boolean;
	readonly backend: BackendFactory;
	readonly receiver: TerminalHookReceiver | undefined;
	/** The core's `hold`/`release`, reached once the seam exists (it is built after the HTTP wiring). */
	connect(seam: Pick<ContractSeam, "hold" | "release">): void;
}

export interface ClaudeCodeWiringDeps {
	readonly settings: ClaudeCodeSettings;
	readonly cli: () => ClaudeCliPath;
	readonly version: string;
	readonly log: (message: string) => void;
	readonly appendSystemPrompt?: string;
}

const NOT_YET = {
	status: "rejected",
	rejection: { code: "closed", message: "the bridge core is not up yet" },
} as const;

export function createClaudeCodeWiring(deps: ClaudeCodeWiringDeps): ClaudeCodeWiring {
	const { terminalAsks } = deps.settings;
	let seam: Pick<ContractSeam, "hold" | "release"> | undefined;
	const receiver = terminalAsks
		? createTerminalHookReceiver({
				hold: async (ref: SessionRef) => (seam ? seam.hold(ref) : NOT_YET),
				release: (ref: SessionRef) => seam?.release(ref),
				log: deps.log,
			})
		: undefined;
	return {
		terminalAsks,
		backend: claudeCodeBackend({
			cli: deps.cli,
			version: deps.version,
			hookAsks: receiver?.setHandler,
			...(deps.appendSystemPrompt !== undefined && { appendSystemPrompt: deps.appendSystemPrompt }),
		}),
		receiver,
		connect: (next) => {
			seam = next;
		},
	};
}
