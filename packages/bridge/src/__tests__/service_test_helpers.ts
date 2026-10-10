import type { CommandRunner, RunResult } from "../platform/command";
import type { ServiceHost } from "../platform/service/types";

export interface CommandCall {
	cmd: string;
	args: string[];
}

export interface CommandRecorder {
	host: ServiceHost;
	calls: CommandCall[];
}

export interface RecorderOptions {
	home: string;
	uid?: number;
	user?: string;
	/** Per-command result overrides; anything unset succeeds with empty output. */
	reply?: (cmd: string, args: string[]) => Partial<RunResult> | undefined;
}

export function recordCommands(options: RecorderOptions): CommandRecorder {
	const calls: CommandCall[] = [];
	const run: CommandRunner = (cmd, args) => {
		calls.push({ cmd, args });
		return { ok: true, stdout: "", stderr: "", status: 0, ...(options.reply?.(cmd, args) ?? {}) };
	};
	return {
		host: { run, home: options.home, uid: options.uid ?? 501, user: options.user ?? "tester" },
		calls,
	};
}

export function commandLines(calls: CommandCall[]): string[] {
	return calls.map((call) => [call.cmd, ...call.args].join(" "));
}
