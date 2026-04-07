import type { CodexThread } from "../../types";

type MapCodexThreadParams = {
	thread: any;
	nameOverride?: string;
	safeString: (value: unknown) => string;
};

/** Maps Codex SDK v2 Thread shape to bridge CodexThread. */
export function mapCodexThreadFromSdk({
	thread,
	nameOverride,
	safeString,
}: MapCodexThreadParams): CodexThread & { threadName?: string } {
	const gitInfo =
		thread?.gitInfo && typeof thread.gitInfo === "object"
			? { branch: safeString(thread.gitInfo.branch) || undefined }
			: null;

	const threadName =
		nameOverride || safeString(thread?.name ?? thread?.threadName ?? thread?.thread_name).trim() || undefined;

	const statusType = safeString(thread?.status?.type).trim();
	const status = statusType
		? {
				type: statusType,
				activeFlags: Array.isArray(thread?.status?.activeFlags)
					? thread.status.activeFlags.map((f: unknown) => safeString(f)).filter(Boolean)
					: undefined,
			}
		: undefined;

	const summary =
		thread?.summary && typeof thread.summary === "object"
			? {
					additions: Number(thread.summary.additions ?? 0),
					deletions: Number(thread.summary.deletions ?? 0),
					files: Number(thread.summary.files ?? 0),
				}
			: undefined;

	const forkedFromId = safeString(thread?.forkedFromId).trim() || null;

	return {
		id: safeString(thread?.id),
		...(forkedFromId ? { forkedFromId } : {}),
		preview: safeString(thread?.preview),
		modelProvider: safeString(thread?.modelProvider) || undefined,
		createdAt: Number(thread?.createdAt ?? 0) || 0,
		updatedAt: Number(thread?.updatedAt ?? thread?.createdAt ?? 0) || 0,
		cwd: safeString(thread?.cwd),
		cliVersion: safeString(thread?.cliVersion) || undefined,
		source: safeString(thread?.source) || undefined,
		gitInfo,
		...(status ? { status } : {}),
		...(safeString(thread?.agentNickname).trim() ? { agentNickname: safeString(thread?.agentNickname) } : {}),
		...(safeString(thread?.agentRole).trim() ? { agentRole: safeString(thread?.agentRole) } : {}),
		...(summary ? { summary } : {}),
		...(threadName ? { threadName } : {}),
	} as CodexThread & { threadName?: string };
}
