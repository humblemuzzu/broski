import { basename } from "node:path";
import type { GlobalSession, Project, Session } from "@opencode-ai/sdk/v2";
import type { ProjectSummary, PtySession, SessionSummary } from "../../types";

/**
 * Map LSP SymbolKind (number) to a human-readable string.
 * SDK returns Symbol.kind as a number matching the LSP spec.
 * Flutter expects a lowercase string for icon mapping.
 * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#symbolKind
 */
const LSP_SYMBOL_KIND_MAP: Record<number, string> = {
	1: "file",
	2: "module",
	3: "namespace",
	4: "package",
	5: "class",
	6: "method",
	7: "property",
	8: "field",
	9: "constructor",
	10: "enum",
	11: "interface",
	12: "function",
	13: "variable",
	14: "constant",
	15: "string",
	16: "number",
	17: "boolean",
	18: "array",
	19: "object",
	20: "key",
	21: "null",
	22: "enummember",
	23: "struct",
	24: "event",
	25: "operator",
	26: "typeparameter",
};

export function lspSymbolKindToString(kind: unknown): string {
	if (typeof kind === "string") return kind;
	if (typeof kind === "number") return LSP_SYMBOL_KIND_MAP[kind] ?? "unknown";
	return "unknown";
}

export function mapPtySession(pty: any): PtySession {
	return {
		id: pty.id ?? "",
		title: pty.title ?? "Terminal",
		command: pty.command ?? "",
		args: pty.args ?? [],
		cwd: pty.cwd ?? "",
		status: pty.status === "running" ? "running" : "exited",
		pid: pty.pid ?? 0,
		exitCode: pty.exitCode,
	};
}

export function mapProject(project: Project): ProjectSummary {
	const path = project.worktree;
	const fallbackName = basename(path) || path;
	return {
		id: project.id,
		name: project.name ?? fallbackName,
		path,
		lastOpened: project.time?.initialized ?? project.time?.created,
		icon: project.icon?.override,
	};
}

export function mapSession(session: Session | GlobalSession): SessionSummary {
	return {
		id: session.id,
		slug: session.slug ?? undefined,
		title: session.title,
		projectID: session.projectID,
		workspaceID: session.workspaceID,
		directory: session.directory,
		parentID: session.parentID,
		time: session.time,
		summary: session.summary,
		share: session.share,
		revert: session.revert ?? undefined,
		permission: session.permission ?? undefined,
		project:
			"project" in session && session.project
				? {
						id: session.project.id,
						name: session.project.name,
						worktree: session.project.worktree,
					}
				: undefined,
	};
}
