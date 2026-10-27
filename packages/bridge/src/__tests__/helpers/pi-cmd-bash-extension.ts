/**
 * A Pi extension that replaces the built-in bash tool with one whose command parameter is `cmd`, the shape
 * a user's own tools extension gives it. The process group is killed when the run is aborted, and output is
 * streamed through `onUpdate` the way the built-in tool does.
 */
export const CMD_BASH_EXTENSION = `
import { spawn } from "node:child_process";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";

const bashTool = defineTool({
	name: "bash",
	label: "Bash",
	description: "Executes the given shell command using bash.",
	parameters: Type.Object({
		cmd: Type.String({ description: "The shell command to execute." }),
		timeout: Type.Number({ description: "Seconds before the command is stopped." }),
	}),
	async execute(_toolCallId, params, signal, onUpdate, ctx) {
		return await new Promise((resolve) => {
			const child = spawn("bash", ["-c", params.cmd], { cwd: ctx.cwd, detached: true });
			let output = "";
			const append = (chunk) => {
				output += chunk.toString();
				onUpdate?.({ content: [{ type: "text", text: output }], details: { command: params.cmd } });
			};
			child.stdout.on("data", append);
			child.stderr.on("data", append);
			const stop = () => {
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {}
			};
			signal?.addEventListener("abort", stop, { once: true });
			child.on("close", (code) => {
				signal?.removeEventListener("abort", stop);
				resolve({
					content: [{ type: "text", text: "$ " + params.cmd + "\\n\\n" + output }],
					details: { command: params.cmd },
					isError: code !== 0,
				});
			});
		});
	},
});

export default function (pi) {
	pi.registerTool(bashTool);
}
`;
