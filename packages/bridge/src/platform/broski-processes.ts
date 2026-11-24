import { basename, dirname } from "node:path";

const INFO_FLAGS = new Set(["--version", "-V", "--help", "-h"]);

/** The arguments after `program` when `command` runs it, else undefined. */
function argsAfter(command: string, program: string): string[] | undefined {
	if (command === program) return [];
	if (!command.startsWith(`${program} `)) return undefined;
	return command
		.slice(program.length + 1)
		.trim()
		.split(/\s+/)
		.filter(Boolean);
}

/** A compiled bridge runs as itself; a source checkout's runs as `bun <script>`. */
function bridgeArgs(command: string, bridge: string): string[] | undefined {
	const direct = argsAfter(command, bridge);
	if (direct) return direct;
	const space = command.indexOf(" ");
	if (space < 0 || basename(command.slice(0, space)) !== "bun") return undefined;
	return argsAfter(command.slice(space + 1), bridge);
}

function servesBridge(args: string[]): boolean {
	const first = args[0];
	if (first === undefined || first === "serve") return true;
	return first.startsWith("-") && !INFO_FLAGS.has(first);
}

/**
 * Pids of the bridge servers and `broski-link run` daemons in `ps -ax -o pid=,command=` output: the processes
 * `broski restart` and `broski stop` may end. Matching the program path, not a word in the command line, keeps
 * every other process that merely mentions broski (an editor, `tail -f ~/.broski/logs/...`, a build of this
 * repository) and every other broski subcommand (a Pi holder, `broski update`) out of it.
 */
export function broskiServerPids(psOutput: string, bridge: string, selfPid: number): number[] {
	const link = `${dirname(bridge)}/broski-link`;
	const pids: number[] = [];
	for (const line of psOutput.split("\n")) {
		const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
		if (!match?.[1] || !match[2]) continue;
		const pid = Number(match[1]);
		const command = match[2];
		if (pid === selfPid) continue;
		const asBridge = bridgeArgs(command, bridge);
		const asLink = argsAfter(command, link);
		if ((asBridge && servesBridge(asBridge)) || asLink?.[0] === "run") pids.push(pid);
	}
	return pids;
}
