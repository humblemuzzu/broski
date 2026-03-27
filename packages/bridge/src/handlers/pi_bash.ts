import * as pi from "../connectors/pi";
import type { ServerMessage } from "../types";

type Reply = (message: ServerMessage) => void;
type Broadcast = (message: ServerMessage) => void;

export async function handle(message: any, reply: Reply, broadcast: Broadcast): Promise<boolean> {
	const cwd =
		typeof message?.projectPath === "string" && message.projectPath.trim()
			? message.projectPath.trim()
			: typeof message?.cwd === "string" && message.cwd.trim()
				? message.cwd.trim()
				: undefined;

	switch (message.type) {
		case "pi_execute_bash": {
			const instance = await pi.getOrCreateInstance(cwd);
			const command = String(message.command ?? "");
			if (!command) {
				reply({
					type: "pi_bash_result",
					data: { output: "", exitCode: 1, cancelled: false, truncated: false, error: "No command provided" },
					requestId: message.requestId,
				});
				return true;
			}

			const excludeFromContext = message.excludeFromContext === true;

			// Stream output chunks to the client
			const onChunk = (chunk: string) => {
				const sessionId = instance.session.sessionId;
				broadcast({
					type: "pi_stream",
					data: { type: "bash-output", content: chunk },
					sessionId,
				});
			};

			try {
				const result = await instance.session.executeBash(command, onChunk, { excludeFromContext });
				reply({
					type: "pi_bash_result",
					data: {
						output: result.output,
						exitCode: result.exitCode ?? null,
						cancelled: result.cancelled,
						truncated: result.truncated,
						fullOutputPath: result.fullOutputPath ?? null,
					},
					requestId: message.requestId,
				});
			} catch (error) {
				reply({
					type: "pi_bash_result",
					data: {
						output: "",
						exitCode: 1,
						cancelled: false,
						truncated: false,
						error: error instanceof Error ? error.message : String(error),
					},
					requestId: message.requestId,
				});
			}
			return true;
		}

		default:
			return false;
	}
}
