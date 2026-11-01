/**
 * What `claudeCode.contract` changes in the bridge (PLAN D28, D29): the adapter is registered with the core, the
 * terminal hook's receiver is served (when `terminalAsks`), and the old protocol's own terminal hook stands down, so
 * one prompt never raises two asks. With the flag off nothing here exists and the old path runs as before.
 */

import type { BackendFactory, SessionRef } from "../contract";
import { createTerminalHookReceiver, type TerminalHookReceiver } from "./cc-terminal-hook";
import type { ClaudeCliPath } from "./claude-cli-path";
import { claudeCodeBackend } from "./claude-code-backend";
import type { ContractSeam } from "./contract-seam";

export interface ClaudeCodeSettings {
	readonly contract: boolean;
	readonly terminalAsks: boolean;
}

export interface ClaudeCodeWiring {
	/** The adapter is served; the old terminal hook is neither installed nor kept. */
	readonly contract: boolean;
	/** Our `PermissionRequest` hook is installed (else removed); only with `contract`. */
	readonly terminalAsks: boolean;
	readonly backend: BackendFactory | undefined;
	readonly receiver: TerminalHookReceiver | undefined;
	/** The core's `hold`/`release`, reached once the seam exists (it is built after the HTTP wiring). */
	connect(seam: Pick<ContractSeam, "hold" | "release">): void;
}

export interface ClaudeCodeWiringDeps {
	readonly settings: ClaudeCodeSettings;
	readonly cli: () => ClaudeCliPath;
	readonly version: string;
	readonly log: (message: string) => void;
}

const NOT_YET = {
	status: "rejected",
	rejection: { code: "closed", message: "the bridge core is not up yet" },
} as const;

export function createClaudeCodeWiring(deps: ClaudeCodeWiringDeps): ClaudeCodeWiring {
	const { contract } = deps.settings;
	const terminalAsks = contract && deps.settings.terminalAsks;
	let seam: Pick<ContractSeam, "hold" | "release"> | undefined;
	const receiver = terminalAsks
		? createTerminalHookReceiver({
				hold: async (ref: SessionRef) => (seam ? seam.hold(ref) : NOT_YET),
				release: (ref: SessionRef) => seam?.release(ref),
				log: deps.log,
			})
		: undefined;
	const backend = contract
		? claudeCodeBackend({ cli: deps.cli, version: deps.version, hookAsks: receiver?.setHandler })
		: undefined;
	return {
		contract,
		terminalAsks,
		backend,
		receiver,
		connect: (next) => {
			seam = next;
		},
	};
}
