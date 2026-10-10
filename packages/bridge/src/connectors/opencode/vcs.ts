import type { VcsDiffFile, VcsInfo } from "../../types";
import type { OpenCodeContext } from "./context";

export async function getVcsInfo(ctx: OpenCodeContext, directory?: string): Promise<VcsInfo> {
	try {
		const { data: vcs } = await ctx.client.vcs.get({ directory });
		return {
			branch: vcs?.branch,
			default_branch: vcs?.default_branch,
		};
	} catch {
		return {};
	}
}

export async function getVcsDiff(
	ctx: OpenCodeContext,
	mode: "git" | "branch",
	directory?: string,
): Promise<VcsDiffFile[]> {
	try {
		const { data } = await ctx.client.vcs.diff({ directory, mode });
		return (data ?? []).map((d) => ({
			file: d.file,
			before: d.before,
			after: d.after,
			additions: d.additions,
			deletions: d.deletions,
			status: d.status,
		}));
	} catch {
		return [];
	}
}
