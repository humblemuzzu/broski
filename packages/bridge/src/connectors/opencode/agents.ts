import type { Agent, Command } from "../../types";
import type { OpenCodeContext } from "./context";

export async function listAgents(ctx: OpenCodeContext, directory?: string): Promise<Agent[]> {
	try {
		const { data: agents } = await ctx.client.app.agents({ directory });
		return (agents ?? []).map((agent: any) => ({
			name: agent.name ?? "",
			description: agent.description,
			color: agent.color,
			mode: agent.mode ?? "primary",
			native: agent.native,
			hidden: agent.hidden,
			topP: agent.topP,
			temperature: agent.temperature,
			permission: Array.isArray(agent.permission) ? agent.permission : undefined,
			model: agent.model,
			variant: agent.variant,
			prompt: agent.prompt,
			options: agent.options,
			steps: typeof agent.steps === "number" ? agent.steps : undefined,
		}));
	} catch {
		return [];
	}
}

export async function listCommands(ctx: OpenCodeContext, directory?: string): Promise<Command[]> {
	try {
		const { data: commands } = await ctx.client.command.list({ directory });

		return (commands ?? []).map((cmd: any) => {
			const source =
				cmd.source === "command" || cmd.source === "mcp" || cmd.source === "skill" ? cmd.source : undefined;

			return {
				name: cmd.name ?? "",
				description: cmd.description,
				source,
				agent: cmd.agent,
				model: cmd.model,
				template: cmd.template,
				subtask: cmd.subtask ?? false,
				hints: Array.isArray(cmd.hints)
					? cmd.hints.map((h: unknown) => (typeof h === "string" ? h : "")).filter((h: string) => h.length > 0)
					: [],
			};
		});
	} catch {
		return [];
	}
}

export async function listSdkSkills(
	ctx: OpenCodeContext,
	directory?: string,
): Promise<Array<{ name: string; description: string; location: string; content: string }>> {
	try {
		const { data: result } = await ctx.client.app.skills({ directory });
		return (result ?? []).map((s: any) => ({
			name: s.name ?? "",
			description: s.description ?? "",
			location: s.location ?? "",
			content: s.content ?? "",
		}));
	} catch {
		return [];
	}
}
