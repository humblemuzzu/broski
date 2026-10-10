import type { Project } from "@opencode-ai/sdk/v2";
import type { ProjectSummary } from "../../types";
import type { OpenCodeContext } from "./context";
import { mapProject } from "./mappers";

export async function listProjects(ctx: OpenCodeContext): Promise<ProjectSummary[]> {
	const { data: projects } = await ctx.client.project.list({});
	return (projects ?? []).map((project) => mapProject(project));
}

export async function getCurrentProject(ctx: OpenCodeContext, directory?: string): Promise<Project | null> {
	try {
		const { data: result } = await ctx.client.project.current({ directory });
		return result ?? null;
	} catch {
		return null;
	}
}

export async function updateProject(
	ctx: OpenCodeContext,
	projectId: string,
	updates: { name?: string; icon?: Record<string, unknown> },
	directory?: string,
): Promise<Project | null> {
	try {
		const { data: result } = await ctx.client.project.update({
			projectID: projectId,
			directory,
			...(updates.name ? { name: updates.name } : {}),
			...(updates.icon ? { icon: updates.icon } : {}),
		});
		return result ?? null;
	} catch {
		return null;
	}
}

export async function initGit(ctx: OpenCodeContext, directory?: string): Promise<any> {
	const { data } = await ctx.client.project.initGit({ directory });
	return data;
}

export async function getPaths(ctx: OpenCodeContext, directory?: string): Promise<any> {
	const { data } = await ctx.client.path.get({ directory });
	return data;
}
