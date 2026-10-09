import { basename, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type Auth,
	createOpencodeClient,
	type FilePartInput,
	type FilePartSource,
	type GlobalEvent,
	type GlobalSession,
	type McpLocalConfig,
	type McpRemoteConfig,
	type Config as OpenCodeConfig,
	type PermissionRequest as OpenCodePermissionRequest,
	type QuestionRequest as OpenCodeQuestionRequest,
	type Workspace as OpenCodeWorkspace,
	type OpencodeClient,
	type OutputFormat,
	type Part,
	type Project,
	type Session,
	type SessionMessageResponse,
	type TextPartInput,
} from "@opencode-ai/sdk/v2";
import { homedir } from "os";
import type {
	Agent,
	Command,
	FileAttachment,
	FileContent,
	FileStatusInfo,
	FormatterInfo,
	LspServerStatus,
	McpResource,
	McpServerStatus,
	ModelInfo,
	PermissionRuleset,
	ProjectSummary,
	ProviderAuthAuthorization,
	ProviderAuthMethod,
	ProviderInfo,
	PtySession,
	SessionContextInfo,
	SessionStatusInfo,
	SessionSummary,
	SymbolResult,
	TextSearchResult,
	Todo,
	ToolInfo,
	VcsDiffFile,
	VcsInfo,
	Worktree,
} from "../types";
import {
	listOpenCodeSessionsInternal,
	listOpenCodeSessionsWithCache,
	type OpenCodeSessionListOptions,
} from "./opencode/session-list";

const DEFAULT_BASE_URL = "http://localhost:4096";
const DEBUG_RTS = process.env.BROSKI_DEBUG_RTS === "1";

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

function lspSymbolKindToString(kind: unknown): string {
	if (typeof kind === "string") return kind;
	if (typeof kind === "number") return LSP_SYMBOL_KIND_MAP[kind] ?? "unknown";
	return "unknown";
}

export type OpenCodeConnectorOptions = {
	baseUrl?: string;
	client?: OpencodeClient;
};

export class OpenCodeConnector {
	private client: OpencodeClient;
	private baseUrl: string;

	// Session list cache with 5s TTL (prevents redundant fetches)
	private sessionCache = new Map<string, { data: SessionSummary[]; fetchedAt: number }>();
	private readonly SESSION_CACHE_TTL_MS = 5000; // 5 seconds

	constructor(options: OpenCodeConnectorOptions = {}) {
		this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
		this.client =
			options.client ??
			createOpencodeClient({
				baseUrl: this.baseUrl,
			});
	}

	// Update the base URL (useful for dynamic port discovery)
	updateBaseUrl(newBaseUrl: string) {
		this.baseUrl = newBaseUrl;
		this.client = createOpencodeClient({
			baseUrl: newBaseUrl,
		});
	}

	get url(): string {
		return this.baseUrl;
	}

	async isRunning(): Promise<boolean> {
		try {
			const response = await fetch(`${this.baseUrl}/path`, {
				signal: AbortSignal.timeout(750),
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	// Get the current OpenCode instance directory
	async getInstanceDirectory(): Promise<string | null> {
		try {
			const response = await fetch(`${this.baseUrl}/path`, {
				signal: AbortSignal.timeout(2000),
			});
			if (!response.ok) return null;
			const data = await response.json();
			return data.directory ?? null;
		} catch {
			return null;
		}
	}

	async listProjects(): Promise<ProjectSummary[]> {
		// v2 SDK: first arg is parameters, second arg is options
		const { data: projects } = await this.client.project.list({});
		return (projects ?? []).map((project) => this.mapProject(project));
	}

	async listSessions(directory?: string, options?: OpenCodeSessionListOptions): Promise<SessionSummary[]> {
		return listOpenCodeSessionsWithCache({
			directory,
			options,
			sessionCache: this.sessionCache,
			cacheTtlMs: this.SESSION_CACHE_TTL_MS,
			listSessionsInternal: (sessionDirectory, sessionOptions) =>
				this._listSessionsInternal(sessionDirectory, sessionOptions),
		});
	}

	invalidateSessionCache(directory?: string): void {
		if (directory) {
			this.sessionCache.delete(directory);
		}
		this.sessionCache.delete("__all__");
	}

	private async _listSessionsInternal(
		directory?: string,
		options?: OpenCodeSessionListOptions,
	): Promise<SessionSummary[]> {
		return listOpenCodeSessionsInternal({
			client: this.client,
			directory,
			options,
			mapSession: (session) => this.mapSession(session),
		});
	}

	async createSession(
		directory?: string,
		title?: string,
		permission?: PermissionRuleset,
		workspaceID?: string,
	): Promise<SessionSummary> {
		const body: Record<string, unknown> = {};
		if (title && title.length > 0) body.title = title;
		if (permission && permission.length > 0) body.permission = permission;
		if (workspaceID) body.workspaceID = workspaceID;

		// v2 SDK: first arg is parameters, second arg is options
		const { data: session } = await this.client.session.create({
			directory,
			...(Object.keys(body).length > 0 ? body : {}),
		});
		return this.mapSession(session!);
	}

	async getSession(sessionId: string, directory?: string): Promise<SessionSummary> {
		// v2 SDK: first arg is parameters, second arg is options
		// Note: v2 SDK uses sessionID (capital ID), not id
		const { data: session } = await this.client.session.get({ sessionID: sessionId, directory });
		return this.mapSession(session!);
	}

	async getSessionMessages(sessionId: string, directory?: string, limit?: number, before?: string) {
		// v2 SDK: first arg is parameters, second arg is options
		// Note: v2 SDK uses sessionID (capital ID), not id
		const { data } = await this.client.session.messages({
			sessionID: sessionId,
			directory,
			limit,
			...(before ? { before } : {}),
		});
		return data;
	}

	async sendPrompt(
		sessionId: string,
		content: string,
		directory?: string,
		messageId?: string,
		model?: { providerID: string; modelID: string },
		agent?: string,
		fileAttachments?: FileAttachment[],
		variant?: string,
		noReply?: boolean,
		system?: string,
	) {
		const parts: Array<TextPartInput | FilePartInput> = [{ type: "text", text: content }];

		if (fileAttachments && fileAttachments.length > 0) {
			const baseDir = directory ?? process.cwd();
			for (const attachment of fileAttachments) {
				if (attachment.base64Data && attachment.mimeType) {
					parts.push({
						type: "file" as const,
						url: `data:${attachment.mimeType};base64,${attachment.base64Data}`,
						filename: basename(attachment.path || "image"),
						mime: attachment.mimeType,
					});
				} else {
					const absolutePath = isAbsolute(attachment.path) ? attachment.path : join(baseDir, attachment.path);
					const filename = basename(attachment.path) || attachment.path;
					parts.push({
						type: "file" as const,
						url: pathToFileURL(absolutePath).href,
						filename: attachment.isDirectory ? `${filename}/` : filename,
						mime: attachment.isDirectory ? "inode/directory" : "text/plain",
					});
				}
			}
		}

		// v2 SDK: first arg is parameters, second arg is options
		// Note: v2 SDK uses sessionID (capital ID), not id
		// Note: `tools` param is deprecated in SDK — use session-level
		// permission rulesets instead (set at session creation or via session.patch).
		return this.client.session.prompt({
			sessionID: sessionId,
			directory,
			...(messageId ? { messageID: messageId } : {}),
			...(model ? { model } : {}),
			...(agent ? { agent } : {}),
			...(variant ? { variant } : {}),
			...(noReply !== undefined ? { noReply } : {}),
			...(system ? { system } : {}),
			parts,
		});
	}

	/**
	 * Async prompt: returns immediately while the session runs in background.
	 * Useful for background jobs.
	 */
	async sendPromptAsync(
		sessionId: string,
		content: string,
		directory?: string,
		model?: { providerID: string; modelID: string },
		agent?: string,
		fileAttachments?: FileAttachment[],
		variant?: string,
		noReply?: boolean,
		system?: string,
		format?: OutputFormat,
	) {
		const parts: Array<TextPartInput | FilePartInput> = [{ type: "text", text: content }];

		if (fileAttachments && fileAttachments.length > 0) {
			const baseDir = directory ?? process.cwd();
			for (const attachment of fileAttachments) {
				if (attachment.base64Data && attachment.mimeType) {
					parts.push({
						type: "file" as const,
						url: `data:${attachment.mimeType};base64,${attachment.base64Data}`,
						filename: basename(attachment.path || "image"),
						mime: attachment.mimeType,
					});
				} else {
					const absolutePath = isAbsolute(attachment.path) ? attachment.path : join(baseDir, attachment.path);
					const filename = basename(attachment.path) || attachment.path;
					parts.push({
						type: "file" as const,
						url: pathToFileURL(absolutePath).href,
						filename: attachment.isDirectory ? `${filename}/` : filename,
						mime: attachment.isDirectory ? "inode/directory" : "text/plain",
					});
				}
			}
		}

		// v2 SDK: first arg is parameters, second arg is options
		// Note: v2 SDK uses sessionID (capital ID), not id
		// Note: `tools` param is deprecated in SDK — use session-level
		// permission rulesets instead (set at session creation or via session.patch).
		return this.client.session.promptAsync({
			sessionID: sessionId,
			directory,
			...(model ? { model } : {}),
			...(agent ? { agent } : {}),
			...(variant ? { variant } : {}),
			...(noReply !== undefined ? { noReply } : {}),
			...(system ? { system } : {}),
			...(format ? { format } : {}),
			parts,
		});
	}

	async abortSession(sessionId: string, directory?: string): Promise<boolean> {
		// v2 SDK: first arg is parameters, second arg is options
		// Note: v2 SDK uses sessionID (capital ID), not id
		const { data } = await this.client.session.abort({ sessionID: sessionId, directory });
		return data === true;
	}

	async getSessionDiff(sessionId: string, directory?: string, messageId?: string) {
		// v2 SDK: first arg is parameters, second arg is options
		// Note: v2 SDK uses sessionID (capital ID), not id
		const { data } = await this.client.session.diff({ sessionID: sessionId, directory, messageID: messageId });
		return data;
	}

	async listFiles(path: string, directory?: string) {
		// Expand ~ to actual home directory
		const resolvedPath = path === "~" || path.startsWith("~/") ? path.replace(/^~/, homedir()) : path;

		// v2 SDK: first arg is parameters, second arg is options
		const { data } = await this.client.file.list({ path: resolvedPath, directory });
		return data;
	}

	async listProviders() {
		// v2 SDK: first arg is parameters, second arg is options
		const { data } = await this.client.config.providers({});
		return data;
	}

	async getConfig(directory?: string) {
		return this.getConfigForDirectory(directory);
	}

	async getConfigForDirectory(directory?: string) {
		// v2 SDK: first arg is parameters, second arg is options
		const { data } = await this.client.config.get(directory ? { directory } : {});
		return data;
	}

	async updateConfig(config: OpenCodeConfig, directory?: string) {
		// v2 SDK: config.update({ directory?, config? })
		const { data } = await this.client.config.update({
			...(directory && directory.length > 0 ? { directory } : {}),
			config,
		});
		return data;
	}

	async updateModel(model: string, directory?: string) {
		return this.updateConfig({ model }, directory);
	}

	async respondToPermission(
		requestId: string,
		response: "once" | "always" | "reject",
		message?: string,
		directory?: string,
	): Promise<boolean> {
		// Use the new permission.reply() API (replaces deprecated postSessionIdPermissionsPermissionId)
		// v2 SDK takes parameters as first arg and options as second arg
		const { data } = await this.client.permission.reply({
			requestID: requestId,
			directory,
			reply: response,
			message,
		});
		return data === true;
	}

	async listPendingPermissions(directory?: string): Promise<OpenCodePermissionRequest[]> {
		try {
			const { data: result } = await this.client.permission.list({ directory });
			return result ?? [];
		} catch {
			return [];
		}
	}

	async listPendingQuestions(directory?: string): Promise<OpenCodeQuestionRequest[]> {
		try {
			const { data: result } = await this.client.question.list({ directory });
			return result ?? [];
		} catch {
			return [];
		}
	}

	async replyToQuestion(requestId: string, answers: string[][], directory?: string): Promise<boolean> {
		try {
			const { data: result } = await this.client.question.reply({
				requestID: requestId,
				directory,
				answers,
			});
			return result === true;
		} catch (err) {
			if (DEBUG_RTS) {
				console.log("[OC Connector] replyToQuestion ERROR:", {
					requestId,
					error: err instanceof Error ? err.message : String(err),
				});
			}
			return false;
		}
	}

	async rejectQuestion(requestId: string, directory?: string): Promise<boolean> {
		try {
			const { data: result } = await this.client.question.reject({
				requestID: requestId,
				directory,
			});
			return result === true;
		} catch (err) {
			if (DEBUG_RTS) {
				console.log("[OC Connector] rejectQuestion ERROR:", {
					requestId,
					error: err instanceof Error ? err.message : String(err),
				});
			}
			return false;
		}
	}

	async startEventStream(onEvent: (event: GlobalEvent) => void): Promise<AbortController> {
		const controller = new AbortController();
		// v2 SDK: global.event() takes only options (no parameters arg)
		const { stream } = await this.client.global.event({ signal: controller.signal });

		void (async () => {
			try {
				for await (const event of stream) {
					onEvent(event);
				}
			} catch {
				// Stream errors are surfaced via retries inside the SDK.
			}
		})();

		return controller;
	}

	async getLspStatus(directory?: string): Promise<LspServerStatus[]> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			const { data: response } = await this.client.lsp.status({ directory });

			// Map SDK LSP status to our type
			const lspServers = response ?? [];
			return lspServers.map((server: any) => ({
				id: server.id ?? "unknown",
				name: server.name ?? server.id ?? "LSP",
				status: server.status === "connected" ? "running" : "error",
				root: server.root,
			}));
		} catch {
			// LSP endpoint might not be available
			return [];
		}
	}

	async disposeInstance(directory?: string): Promise<boolean> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			const { data: result } = await this.client.instance.dispose({ directory });
			return result === true;
		} catch {
			return false;
		}
	}

	async getSessionContext(sessionId: string, directory?: string): Promise<SessionContextInfo> {
		// Get session messages to compute token totals
		const messages = await this.getSessionMessages(sessionId, directory);

		// Get session diff for modified files
		const diffs = await this.getSessionDiff(sessionId, directory);

		// Get LSP status
		const lsp = await this.getLspStatus(directory);

		// Compute token usage from assistant messages
		// OpenCode SDK AssistantMessage shape:
		//   cost: number (per-message cost, cumulative per-message NOT per-token)
		//   tokens: { input, output, reasoning, cache: { read, write } }
		//   modelID: string, providerID: string
		//
		// IMPORTANT: Each assistant message's tokens represent that API call's full
		// token usage (including the full conversation history as input). So we:
		//   - SUM cost across all messages (each msg.cost is incremental)
		//   - Use LAST assistant message's tokens for context window usage
		//     (matches official OpenCode TUI: session-context-metrics.ts)
		let totalCost = 0;
		let contextWindow = 200000; // Default fallback

		// Track the last assistant message (for current context window usage)
		let lastAssistant: any = null;

		for (const msg of messages ?? []) {
			const info = msg?.info;
			if (info?.role === "assistant") {
				// Per-message cost from OpenCode SDK (sum across all messages)
				totalCost += info.cost ?? 0;
				// Track last assistant message with actual token data
				const tokens = info.tokens;
				if (tokens && (tokens.input ?? 0) + (tokens.output ?? 0) > 0) {
					lastAssistant = info;
				}
			}
		}

		// Extract token breakdown from the LAST assistant message
		// This represents the current context window state
		const lastTokens = lastAssistant?.tokens;
		const lastCache = lastTokens?.cache;
		const inputTokens = lastTokens?.input ?? 0;
		const outputTokens = lastTokens?.output ?? 0;
		const reasoningTokens = lastTokens?.reasoning ?? 0;
		const cacheReadTokens = lastCache && typeof lastCache === "object" ? (lastCache.read ?? 0) : 0;
		const cacheWriteTokens = lastCache && typeof lastCache === "object" ? (lastCache.write ?? 0) : 0;
		const lastProviderID: string | undefined = lastAssistant?.providerID;
		const lastModelID: string | undefined = lastAssistant?.modelID;

		// Look up context window from provider model list
		// After listAllProviders mapping: models[modelID].contextWindow
		if (lastProviderID && lastModelID) {
			try {
				const providers = await this.listAllProviders(directory);
				const provider = providers.all.find((p) => p.id === lastProviderID);
				if (provider?.models) {
					const model = provider.models[lastModelID];
					const cw = model?.contextWindow;
					if (typeof cw === "number" && cw > 0) {
						contextWindow = cw;
					}
				}
			} catch {
				// Fall back to default if provider list fails
			}
		}

		// Map diffs to modified files
		const modifiedFiles = (diffs ?? []).map((diff: any) => ({
			file: diff.file ?? "",
			additions: diff.additions ?? 0,
			deletions: diff.deletions ?? 0,
		}));

		// contextTokens = total tokens for the last API call (matches OpenCode TUI)
		// OpenCode official app uses: input + output + reasoning + cache.read + cache.write
		// divided by model context limit for the usage percentage
		const contextTokens = inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens;

		return {
			tokens: {
				input: inputTokens,
				output: outputTokens,
				// Prefer SDK's total (includes reasoning/cache) over manual sum
				total: lastTokens?.total ?? inputTokens + outputTokens,
				contextTokens,
				contextWindow,
				reasoning: reasoningTokens || undefined,
				cacheRead: cacheReadTokens || undefined,
				cacheWrite: cacheWriteTokens || undefined,
			},
			cost: totalCost,
			lsp,
			modifiedFiles,
		};
	}

	// Feature 1: Todo/Plan Management
	async getTodos(sessionId: string, directory?: string): Promise<Todo[]> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			// Note: v2 SDK uses sessionID (capital ID), not id
			const { data: todos } = await this.client.session.todo({ sessionID: sessionId, directory });
			return (todos ?? []).map((todo: any) => ({
				// Note: SDK removed `id` field. Don't send it — Flutter generates
				// a stable id from content.hashCode for widget keys.
				content: todo.content ?? "",
				status: todo.status ?? "pending",
				priority: todo.priority ?? "medium",
			}));
		} catch {
			// Session might not have todos
			return [];
		}
	}

	// Feature 2: Slash Commands
	async listCommands(directory?: string): Promise<Command[]> {
		try {
			const { data: commands } = await this.client.command.list({ directory });

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
			// Commands endpoint might not be available
			return [];
		}
	}

	async executeCommand(
		sessionId: string,
		command: string,
		args: string,
		directory?: string,
		agent?: string,
		model?: string,
		variant?: string,
		parts?: Array<{ id?: string; type: "file"; mime: string; filename?: string; url: string; source?: FilePartSource }>,
	): Promise<unknown> {
		const { data } = await this.client.session.command({
			sessionID: sessionId,
			directory,
			command,
			arguments: args,
			...(agent ? { agent } : {}),
			...(model ? { model } : {}),
			...(variant ? { variant } : {}),
			...(parts && parts.length > 0 ? { parts } : {}),
		});
		return data;
	}

	// Feature 3: Agent Switching
	async listAgents(directory?: string): Promise<Agent[]> {
		try {
			const { data: agents } = await this.client.app.agents({ directory });
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
			// Agents endpoint might not be available
			return [];
		}
	}

	// Feature 4: Session Delete
	async deleteSession(sessionId: string, directory?: string): Promise<boolean> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			// Note: v2 SDK uses sessionID (capital ID), not id
			await this.client.session.delete({ sessionID: sessionId, directory });
			return true;
		} catch {
			return false;
		}
	}

	// Feature 5: Session Update (Rename)
	async updateSession(
		sessionId: string,
		title?: string,
		archived?: boolean,
		directory?: string,
	): Promise<SessionSummary> {
		// v2 SDK: first arg is parameters, second arg is options
		// Note: v2 SDK uses sessionID (capital ID), not id
		const { data: session } = await this.client.session.update({
			sessionID: sessionId,
			directory,
			...(title ? { title } : {}),
			...(archived !== undefined ? { time: { archived: archived ? Date.now() : undefined } } : {}),
		});
		return this.mapSession(session!);
	}

	// Feature 6: Session Fork
	async shellCommand(
		sessionId: string,
		command: string,
		directory?: string,
		agent?: string,
		model?: { providerID: string; modelID: string },
		messageId?: string,
	) {
		const { data } = await this.client.session.shell({
			sessionID: sessionId,
			directory,
			command,
			...(agent ? { agent } : {}),
			...(model ? { model } : {}),
			...(messageId ? { messageID: messageId } : {}),
		});
		return data;
	}

	async forkSession(sessionId: string, messageId?: string, directory?: string): Promise<SessionSummary> {
		// v2 SDK: first arg is parameters, second arg is options
		// Note: v2 SDK uses sessionID (capital ID), not id
		const { data: session } = await this.client.session.fork({
			sessionID: sessionId,
			directory,
			...(messageId ? { messageID: messageId } : {}),
		});
		return this.mapSession(session!);
	}

	async listSessionChildren(sessionId: string, directory?: string): Promise<SessionSummary[]> {
		try {
			const { data: children } = await this.client.session.children({ sessionID: sessionId, directory });
			return (children ?? []).map((session) => this.mapSession(session));
		} catch {
			return [];
		}
	}

	// Feature 7: Message Revert (Undo)
	async revertMessage(
		sessionId: string,
		messageId: string,
		partId?: string,
		directory?: string,
	): Promise<SessionSummary> {
		// v2 SDK: first arg is parameters, second arg is options
		// Note: v2 SDK uses sessionID (capital ID), not id
		const { data: session } = await this.client.session.revert({
			sessionID: sessionId,
			directory,
			messageID: messageId,
			...(partId ? { partID: partId } : {}),
		});
		return this.mapSession(session!);
	}

	async unrevertSession(sessionId: string, directory?: string): Promise<SessionSummary> {
		// v2 SDK: first arg is parameters, second arg is options
		// Note: v2 SDK uses sessionID (capital ID), not id
		const { data: session } = await this.client.session.unrevert({ sessionID: sessionId, directory });
		return this.mapSession(session!);
	}

	// Feature 8: Session Share
	async shareSession(sessionId: string, directory?: string): Promise<SessionSummary> {
		// v2 SDK: first arg is parameters, second arg is options
		// Note: v2 SDK uses sessionID (capital ID), not id
		const { data: session } = await this.client.session.share({ sessionID: sessionId, directory });
		return this.mapSession(session!);
	}

	async unshareSession(sessionId: string, directory?: string): Promise<SessionSummary> {
		// v2 SDK: first arg is parameters, second arg is options
		// Note: v2 SDK uses sessionID (capital ID), not id
		const { data: session } = await this.client.session.unshare({ sessionID: sessionId, directory });
		return this.mapSession(session!);
	}

	// Feature 9: Session Summarize (Compact)
	async summarizeSession(
		sessionId: string,
		providerID: string,
		modelID: string,
		directory?: string,
		auto?: boolean,
	): Promise<boolean> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			// Note: v2 SDK uses sessionID (capital ID), not id
			await this.client.session.summarize({
				sessionID: sessionId,
				directory,
				providerID,
				modelID,
				...(auto !== undefined ? { auto } : {}),
			});
			return true;
		} catch {
			return false;
		}
	}

	// Feature 10: Git/VCS Information
	async getVcsInfo(directory?: string): Promise<VcsInfo> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			const { data: vcs } = await this.client.vcs.get({ directory });
			return {
				branch: vcs?.branch,
				default_branch: vcs?.default_branch,
			};
		} catch {
			// VCS endpoint might not be available or not in a git repo
			return {};
		}
	}

	// Feature 10b: VCS Diff (working tree or vs default branch)
	async getVcsDiff(mode: "git" | "branch", directory?: string): Promise<VcsDiffFile[]> {
		try {
			const { data } = await this.client.vcs.diff({ directory, mode });
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

	// Feature 11: File Content Read
	async readFile(path: string, directory?: string): Promise<FileContent> {
		try {
			const { data: result } = await this.client.file.read({ path, directory });
			const mimeType = result?.mimeType ?? "text/plain";

			return {
				type: result?.type === "binary" ? "binary" : "text",
				content: result?.content ?? "",
				mime: mimeType,
				mimeType,
				encoding: result?.encoding,
				diff: result?.diff,
				patch: result?.patch,
			};
		} catch {
			return { type: "text", content: "", mime: "text/plain", mimeType: "text/plain" };
		}
	}

	// Feature 12: File Search - Find files by name
	async findFiles(query: string, directory?: string): Promise<string[]> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			const { data: result } = await this.client.find.files({ query, directory });
			return result ?? [];
		} catch {
			return [];
		}
	}

	// Feature 12b: File Search - Find files AND directories (for @ autocomplete)
	async searchFilesAndDirs(query: string, directory?: string, limit: number = 20): Promise<string[]> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			// `dirs` is a wire enum (`"true" | "false"`), not a boolean.
			// Pass limit to SDK server-side for efficiency.
			const { data: result } = await this.client.find.files({ query, dirs: "true", directory, limit });
			return result ?? [];
		} catch {
			return [];
		}
	}

	// Feature 12: File Search - Find text in files (ripgrep)
	async findText(pattern: string, include?: string, directory?: string): Promise<TextSearchResult[]> {
		try {
			const { data: result } = await this.client.find.text({ pattern, directory });

			let mapped = (result ?? []).map((item: any) => ({
				path: item.path?.text ?? item.path ?? "",
				lineNumber: item.line_number ?? item.lineNumber ?? 0,
				lineText: item.lines?.text ?? "",
				matches: (item.submatches ?? []).map((m: any) => ({
					text: m.match?.text ?? "",
					start: m.start ?? 0,
					end: m.end ?? 0,
				})),
			}));

			// `include` is not supported by SDK v2 find.text(); keep best-effort
			// client-side filtering for backward compatibility.
			if (include && include.trim().length > 0) {
				const normalized = include.trim().toLowerCase();
				mapped = mapped.filter((entry) => entry.path.toLowerCase().includes(normalized));
			}

			return mapped;
		} catch {
			return [];
		}
	}

	// Feature 12: File Search - Find symbols (LSP)
	async findSymbols(query: string, directory?: string): Promise<SymbolResult[]> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			const { data: result } = await this.client.find.symbols({ query, directory });
			return (result ?? []).map((item: any) => ({
				name: item.name ?? "",
				kind: lspSymbolKindToString(item.kind),
				path: item.path ?? item.location?.uri ?? "",
				line: item.line ?? item.location?.range?.start?.line ?? 0,
				column: item.column ?? item.location?.range?.start?.character ?? 0,
			}));
		} catch {
			return [];
		}
	}

	// Feature 13: Session Status
	async getSessionStatus(directory?: string): Promise<Record<string, SessionStatusInfo>> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			const { data: result } = await this.client.session.status({ directory });
			const mapped: Record<string, SessionStatusInfo> = {};
			for (const [sessionId, status] of Object.entries(result ?? {})) {
				const s = status as { type?: string; attempt?: number; message?: string; next?: number };
				if (s.type === "busy") {
					mapped[sessionId] = { type: "busy" };
				} else if (s.type === "retry") {
					mapped[sessionId] = {
						type: "retry",
						attempt: s.attempt ?? 0,
						message: s.message ?? "",
						next: s.next ?? 0,
					};
				} else {
					mapped[sessionId] = { type: "idle" };
				}
			}
			return mapped;
		} catch {
			return {};
		}
	}

	// Feature 14: PTY Terminal Sessions - List
	async listPty(directory?: string): Promise<PtySession[]> {
		try {
			// Use instance directory if none provided
			const dir = directory ?? (await this.getInstanceDirectory());
			// v2 SDK: first arg is parameters, second arg is options
			const { data: result } = await this.client.pty.list({ directory: dir ?? undefined });
			return (result ?? []).map((pty: any) => this.mapPtySession(pty));
		} catch (error) {
			console.error("[PTY] listPty failed:", error);
			return [];
		}
	}

	// Feature 14: PTY Terminal Sessions - Create
	async createPty(
		command?: string,
		args?: string[],
		cwd?: string,
		title?: string,
		env?: Record<string, string>,
		directory?: string,
	): Promise<PtySession | null> {
		try {
			// Use instance directory if none provided
			const dir = directory ?? (await this.getInstanceDirectory());
			// v2 SDK: first arg is parameters, second arg is options
			const { data: result } = await this.client.pty.create({
				directory: dir ?? undefined,
				...(command ? { command } : {}),
				...(args ? { args } : {}),
				...(cwd ? { cwd } : {}),
				...(title ? { title } : {}),
				...(env && Object.keys(env).length > 0 ? { env } : {}),
			});
			return result ? this.mapPtySession(result) : null;
		} catch (error) {
			console.error("[PTY] createPty failed:", error);
			return null;
		}
	}

	// Feature 14: PTY Terminal Sessions - Get
	async getPty(ptyId: string, directory?: string): Promise<PtySession | null> {
		try {
			// Use instance directory if none provided
			const dir = directory ?? (await this.getInstanceDirectory());
			// v2 SDK: first arg is parameters, second arg is options
			// Note: v2 SDK uses ptyID (capital ID), not id
			const { data: result } = await this.client.pty.get({ ptyID: ptyId, directory: dir ?? undefined });
			return result ? this.mapPtySession(result) : null;
		} catch (error) {
			console.error("[PTY] getPty failed:", error);
			return null;
		}
	}

	// Feature 14: PTY Terminal Sessions - Update
	async updatePty(
		ptyId: string,
		title?: string,
		rows?: number,
		cols?: number,
		directory?: string,
	): Promise<PtySession | null> {
		try {
			// Use instance directory if none provided
			const dir = directory ?? (await this.getInstanceDirectory());
			// v2 SDK: first arg is parameters, second arg is options
			// Note: v2 SDK uses ptyID (capital ID), not id
			const { data: result } = await this.client.pty.update({
				ptyID: ptyId,
				directory: dir ?? undefined,
				...(title ? { title } : {}),
				...(rows && cols ? { size: { rows, cols } } : {}),
			});
			return result ? this.mapPtySession(result) : null;
		} catch (error) {
			console.error("[PTY] updatePty failed:", error);
			return null;
		}
	}

	// Feature 14: PTY Terminal Sessions - Delete
	async deletePty(ptyId: string, directory?: string): Promise<boolean> {
		try {
			// Use instance directory if none provided
			const dir = directory ?? (await this.getInstanceDirectory());
			// v2 SDK: first arg is parameters, second arg is options
			// Note: v2 SDK uses ptyID (capital ID), not id
			await this.client.pty.remove({ ptyID: ptyId, directory: dir ?? undefined });
			return true;
		} catch (error: any) {
			console.error("[PTY] deletePty failed:", error?.message || error);
			// Return true if it's a 404 (already deleted)
			if (error?.response?.status === 404) {
				return true;
			}
			return false;
		}
	}

	// Feature 15: MCP Server Management - Status
	async getMcpStatus(directory?: string): Promise<Record<string, McpServerStatus>> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			const { data: result } = await this.client.mcp.status({ directory });
			const mapped: Record<string, McpServerStatus> = {};
			for (const [name, status] of Object.entries(result ?? {})) {
				const s = status as {
					status?: string;
					error?: string;
					tools?: string[];
					resources?: string[];
				};
				mapped[name] = {
					name,
					status: (typeof s.status === "string" ? s.status : "failed") as McpServerStatus["status"],
					error: s.error,
					tools: s.tools ?? [],
					resources: s.resources ?? [],
				};
			}
			return mapped;
		} catch {
			return {};
		}
	}

	// Feature 15: MCP Server Management - Add
	async addMcp(
		name: string,
		config: Record<string, unknown>,
		directory?: string,
	): Promise<Record<string, McpServerStatus>> {
		try {
			const { data: result } = await this.client.mcp.add({
				directory,
				name,
				config: config as unknown as McpLocalConfig | McpRemoteConfig,
			});

			const mapped: Record<string, McpServerStatus> = {};
			for (const [serverName, status] of Object.entries(result ?? {})) {
				const s = status as {
					status?: string;
					error?: string;
					tools?: string[];
					resources?: string[];
				};
				mapped[serverName] = {
					name: serverName,
					status: (typeof s.status === "string" ? s.status : "failed") as McpServerStatus["status"],
					error: s.error,
					tools: s.tools ?? [],
					resources: s.resources ?? [],
				};
			}
			return mapped;
		} catch {
			return {};
		}
	}

	// Feature 15: MCP Server Management - Connect
	async connectMcp(name: string, directory?: string): Promise<boolean> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			await this.client.mcp.connect({ name, directory });
			return true;
		} catch {
			return false;
		}
	}

	// Feature 15: MCP Server Management - Disconnect
	async disconnectMcp(name: string, directory?: string): Promise<boolean> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			await this.client.mcp.disconnect({ name, directory });
			return true;
		} catch {
			return false;
		}
	}

	// Feature 15c: MCP OAuth Authentication
	async mcpAuthStart(name: string, directory?: string): Promise<{ authorizationUrl: string } | null> {
		try {
			const { data: result } = await this.client.mcp.auth.start({ name, directory });
			return result ?? null;
		} catch (error) {
			console.error("[mcpAuthStart] Error:", error);
			return null;
		}
	}

	async mcpAuthCallback(name: string, code: string, directory?: string): Promise<boolean> {
		try {
			const { data: result } = await this.client.mcp.auth.callback({ name, directory, code });
			// result is McpStatus on success
			return result != null;
		} catch (error) {
			console.error("[mcpAuthCallback] Error:", error);
			return false;
		}
	}

	/**
	 * One-shot MCP OAuth: starts flow, opens browser on the SERVER machine,
	 * waits for callback, returns final MCP status. Best when the user can
	 * see the dev machine screen. For fully-remote auth use the two-step
	 * mcpAuthStart() + mcpAuthCallback() flow instead.
	 */
	async mcpAuthAuthenticate(name: string, directory?: string): Promise<Record<string, unknown> | null> {
		try {
			const { data: result } = await this.client.mcp.auth.authenticate({ name, directory });
			// SDK returns McpStatus on success
			return result ? { ...result } : null;
		} catch (error) {
			console.error("[mcpAuthAuthenticate] Error:", error);
			return null;
		}
	}

	async mcpAuthRemove(name: string, directory?: string): Promise<boolean> {
		try {
			const { data: result } = await this.client.mcp.auth.remove({ name, directory });
			return result != null;
		} catch {
			return false;
		}
	}

	// Feature 15b: MCP Resources (SDK v1.1.1+ experimental)
	async getMcpResources(directory?: string): Promise<Record<string, McpResource>> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			const { data: result } = await this.client.experimental.resource.list({ directory });
			// Map the result to our McpResource type
			const mapped: Record<string, McpResource> = {};
			for (const [key, resource] of Object.entries(result ?? {})) {
				const r = resource as {
					name?: string;
					uri?: string;
					description?: string;
					mimeType?: string;
					client?: string;
				};
				mapped[key] = {
					name: r.name ?? "",
					uri: r.uri ?? "",
					description: r.description,
					mimeType: r.mimeType,
					client: r.client ?? "",
				};
			}
			return mapped;
		} catch (error) {
			console.error("[getMcpResources] Error:", error);
			return {};
		}
	}

	// Feature 23: Git Worktrees (SDK v1.1.1+ experimental)
	async listWorktrees(directory?: string): Promise<Worktree[]> {
		try {
			// The SDK returns an array of directory strings, not full Worktree objects
			// We need to parse them or return basic info
			// v2 SDK: first arg is parameters, second arg is options
			const { data: result } = await this.client.worktree.list({ directory });
			// The SDK experimental endpoint returns string[] of directories
			// Enrich with branch info by querying VCS for each directory.
			const dirs = result ?? [];
			const concurrency = 6;
			const queue = dirs.slice();
			const out: Worktree[] = [];

			await Promise.all(
				Array.from({ length: Math.max(1, concurrency) }, async () => {
					for (;;) {
						const dir = queue.shift();
						if (!dir) break;
						let branch = "";
						try {
							// v2 SDK pattern
							const { data: vcs } = await this.client.vcs.get({ directory: dir });
							branch = vcs?.branch ?? "";
						} catch {
							branch = "";
						}
						out.push({
							name: basename(dir) || dir,
							branch,
							directory: dir,
						});
					}
				}),
			);

			return out.sort((a, b) => a.directory.localeCompare(b.directory));
		} catch (error) {
			console.error("[listWorktrees] Error:", error);
			return [];
		}
	}

	async createWorktree(name?: string, startCommand?: string, directory?: string): Promise<Worktree | null> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			const { data: result } = await this.client.worktree.create({
				directory,
				worktreeCreateInput: {
					name,
					startCommand,
				},
			});
			if (!result) return null;

			// IMPORTANT: The OpenCode SDK creates the git worktree but does NOT
			// register it in the project's sandboxes array. We need to "touch" the
			// new worktree directory with any API call to trigger Instance.provide()
			// -> Project.fromDirectory() -> sandboxes.push(). This makes the worktree
			// show up in listWorktrees() after app restart.
			if (result.directory) {
				try {
					// Any API call with the new directory will register it
					await this.client.vcs.get({ directory: result.directory });
					console.log("[createWorktree] Registered sandbox:", result.directory);
				} catch {
					// Non-fatal: worktree was still created, just may not persist in list
					console.warn("[createWorktree] Failed to register sandbox, worktree may not persist in list");
				}
			}

			return {
				name: result.name ?? "",
				branch: result.branch ?? "",
				directory: result.directory ?? "",
			};
		} catch (error) {
			console.error("[createWorktree] Error:", error);
			return null;
		}
	}

	async resetWorktree(worktreeDirectory: string, directory?: string): Promise<boolean> {
		try {
			if (!directory || directory.length === 0) return false;
			const target = isAbsolute(worktreeDirectory) ? worktreeDirectory : join(directory, worktreeDirectory);

			const { data: result } = await this.client.worktree.reset({
				directory,
				worktreeResetInput: { directory: target },
			});

			return result === true;
		} catch {
			return false;
		}
	}

	async deleteWorktree(worktreeDirectory: string, directory?: string): Promise<boolean> {
		try {
			if (!directory || directory.length === 0) return false;
			const target = isAbsolute(worktreeDirectory) ? worktreeDirectory : join(directory, worktreeDirectory);

			// Use the official OpenCode API for worktree removal.
			// This keeps OpenCode's internal sandbox/worktree bookkeeping consistent.
			const { data: result } = await this.client.worktree.remove({
				directory,
				worktreeRemoveInput: { directory: target },
			});

			return result === true;
		} catch {
			return false;
		}
	}

	// Feature 16: Full Provider Management - List all providers
	async listAllProviders(directory?: string): Promise<ProviderInfo> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			const { data: result } = await this.client.provider.list({ directory });
			return {
				all: (result?.all ?? []).map((p) => {
					// Map SDK ProviderListResponses model shape to our enriched ModelInfo
					const rawModels = p.models ?? {};
					const mappedModels: Record<string, ModelInfo> = {};
					for (const [modelId, model] of Object.entries(rawModels)) {
						const m = model as {
							id?: string;
							name?: string;
							family?: string;
							limit?: { context?: number; output?: number };
							reasoning?: boolean;
							attachment?: boolean;
							tool_call?: boolean;
							modalities?: { input?: string[]; output?: string[] };
							status?: string;
							experimental?: boolean;
							cost?: {
								input?: number;
								output?: number;
								cache_read?: number;
								cache_write?: number;
							};
							variants?: Record<string, Record<string, unknown>>;
						};
						mappedModels[modelId] = {
							id: m.id ?? modelId,
							name: m.name ?? modelId,
							family: m.family ?? undefined,
							contextWindow: m.limit?.context ?? undefined,
							outputLimit: m.limit?.output ?? undefined,
							reasoning: m.reasoning ?? undefined,
							attachment: m.attachment ?? undefined,
							toolCall: m.tool_call ?? undefined,
							modalities: m.modalities as { input: string[]; output: string[] } | undefined,
							status: m.status as ModelInfo["status"],
							experimental: m.experimental ?? undefined,
							pricing: m.cost
								? {
										input: m.cost.input ?? 0,
										output: m.cost.output ?? 0,
										cacheRead: m.cost.cache_read ?? undefined,
										cacheWrite: m.cost.cache_write ?? undefined,
									}
								: undefined,
							variants: m.variants ?? undefined,
						};
					}
					return {
						id: p.id ?? "",
						name: p.name ?? p.id ?? "",
						models: mappedModels,
					};
				}),
				default: result?.default ?? {},
				connected: result?.connected ?? [],
			};
		} catch {
			return { all: [], default: {}, connected: [] };
		}
	}

	// Feature 16: Full Provider Management - Get auth methods
	async getProviderAuth(directory?: string): Promise<Record<string, ProviderAuthMethod[]>> {
		try {
			const { data: result } = await this.client.provider.auth({ directory });
			const mapped: Record<string, ProviderAuthMethod[]> = {};
			for (const [providerId, methods] of Object.entries(result ?? {})) {
				const methodList = Array.isArray(methods) ? (methods as any[]) : [];
				mapped[providerId] = methodList.map((m) => ({
					type: m.type === "oauth" ? ("oauth" as const) : ("api" as const),
					label: m.label,
					name: m.name,
					description: m.description,
					url: m.url,
					prompts: Array.isArray(m.prompts) ? m.prompts : undefined,
				}));
			}
			return mapped;
		} catch {
			return {};
		}
	}

	async providerOauthAuthorize(
		providerId: string,
		method: number,
		directory?: string,
		inputs?: Record<string, string>,
	): Promise<ProviderAuthAuthorization | null> {
		try {
			const { data: result } = await this.client.provider.oauth.authorize({
				providerID: providerId,
				directory,
				method,
				...(inputs ? { inputs } : {}),
			});
			if (!result) return null;
			return {
				url: result.url ?? "",
				method: result.method === "code" ? "code" : "auto",
				instructions: result.instructions ?? "",
			};
		} catch {
			return null;
		}
	}

	async providerOauthCallback(providerId: string, method: number, code?: string, directory?: string): Promise<boolean> {
		try {
			const { data: result } = await this.client.provider.oauth.callback({
				providerID: providerId,
				directory,
				method,
				...(code ? { code } : {}),
			});
			return result === true;
		} catch {
			return false;
		}
	}

	// Feature 17: Tool List - Get tool IDs
	async listToolIds(directory?: string): Promise<string[]> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			const { data: result } = await this.client.tool.ids({ directory });
			return result ?? [];
		} catch (error) {
			console.error("[listToolIds] Error:", error);
			return [];
		}
	}

	// Feature 17: Tool List - Get tools with details
	async listTools(provider: string, model: string, directory?: string): Promise<ToolInfo[]> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			const { data: result } = await this.client.tool.list({ provider, model, directory });
			return (result ?? []).map((tool: any) => ({
				id: tool.id ?? "",
				description: tool.description,
				parameters: tool.parameters,
			}));
		} catch {
			return [];
		}
	}

	// Feature 18: File Status (Git)
	async getFileStatus(directory?: string): Promise<FileStatusInfo[]> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			const { data: result } = await this.client.file.status({ directory });
			return (result ?? []).map((f: any) => ({
				path: f.path ?? "",
				added: typeof f.added === "number" ? f.added : 0,
				removed: typeof f.removed === "number" ? f.removed : 0,
				status: f.status ?? "modified",
			}));
		} catch {
			return [];
		}
	}

	// Feature 19: Formatter Status
	async getFormatterStatus(directory?: string): Promise<FormatterInfo[]> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			// SDK FormatterStatus shape: { name: string; extensions: string[]; enabled: boolean }
			const { data: result } = await this.client.formatter.status({ directory });
			return (result ?? []).map((f: any) => ({
				name: f.name ?? "",
				extensions: Array.isArray(f.extensions) ? f.extensions : [],
				enabled: f.enabled === true,
			}));
		} catch (error) {
			console.error("[getFormatterStatus] Error:", error);
			return [];
		}
	}

	// Feature 20: Session Init (Create AGENTS.md)
	async initSession(
		sessionId: string,
		providerID: string,
		modelID: string,
		messageID: string,
		directory?: string,
	): Promise<boolean> {
		try {
			// v2 SDK: first arg is parameters, second arg is options
			// Note: v2 SDK uses sessionID (capital ID), not id
			await this.client.session.init({ sessionID: sessionId, directory, providerID, modelID, messageID });
			return true;
		} catch {
			return false;
		}
	}

	// Provider credential management
	async authSet(providerId: string, auth: Auth): Promise<boolean> {
		try {
			const { data: result } = await this.client.auth.set({ providerID: providerId, auth });
			return result === true;
		} catch {
			return false;
		}
	}

	async authRemove(providerId: string): Promise<boolean> {
		try {
			const { data: result } = await this.client.auth.remove({ providerID: providerId });
			return result === true;
		} catch {
			return false;
		}
	}

	// Global config
	async getGlobalConfig(): Promise<Record<string, unknown>> {
		try {
			const { data: result } = await this.client.global.config.get();
			return result ?? {};
		} catch {
			return {};
		}
	}

	async updateGlobalConfig(config: OpenCodeConfig): Promise<Record<string, unknown>> {
		try {
			const { data: result } = await this.client.global.config.update({ config });
			return result ?? {};
		} catch {
			return {};
		}
	}

	// Project management
	async getCurrentProject(directory?: string): Promise<Project | null> {
		try {
			const { data: result } = await this.client.project.current({ directory });
			return result ?? null;
		} catch {
			return null;
		}
	}

	async updateProject(
		projectId: string,
		updates: { name?: string; icon?: Record<string, unknown> },
		directory?: string,
	): Promise<Project | null> {
		try {
			const { data: result } = await this.client.project.update({
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

	async initGit(directory?: string): Promise<any> {
		const { data } = await this.client.project.initGit({ directory });
		return data;
	}

	async getPaths(directory?: string): Promise<any> {
		const { data } = await this.client.path.get({ directory });
		return data;
	}

	// Message part editing
	async deletePart(sessionId: string, messageId: string, partId: string, directory?: string): Promise<boolean> {
		try {
			const { data: result } = await this.client.part.delete({
				sessionID: sessionId,
				messageID: messageId,
				partID: partId,
				directory,
			});
			return result === true;
		} catch {
			return false;
		}
	}

	async updatePart(
		sessionId: string,
		messageId: string,
		partId: string,
		part: Part,
		directory?: string,
	): Promise<Part | null> {
		try {
			const { data: result } = await this.client.part.update({
				sessionID: sessionId,
				messageID: messageId,
				partID: partId,
				directory,
				part,
			});
			return result ?? null;
		} catch {
			return null;
		}
	}

	async deleteMessage(sessionId: string, messageId: string, directory?: string): Promise<boolean> {
		try {
			const { data: result } = await this.client.session.deleteMessage({
				sessionID: sessionId,
				messageID: messageId,
				directory,
			});
			return result === true;
		} catch {
			return false;
		}
	}

	async getMessage(sessionId: string, messageId: string, directory?: string): Promise<SessionMessageResponse | null> {
		try {
			const { data: result } = await this.client.session.message({
				sessionID: sessionId,
				messageID: messageId,
				directory,
			});
			return result ?? null;
		} catch {
			return null;
		}
	}

	async listWorkspaces(directory?: string): Promise<OpenCodeWorkspace[]> {
		try {
			const { data: result } = await this.client.experimental.workspace.list({ directory });
			return result ?? [];
		} catch {
			return [];
		}
	}

	async createWorkspace(
		id: string,
		options: { branch?: string | null; config?: { directory: string; type: "worktree" } },
		directory?: string,
	): Promise<OpenCodeWorkspace | null> {
		try {
			const { data: result } = await this.client.experimental.workspace.create({
				id,
				directory,
				...(options.branch !== undefined ? { branch: options.branch } : {}),
				...(options.config ? { config: options.config } : {}),
			});
			return result ?? null;
		} catch {
			return null;
		}
	}

	async removeWorkspace(id: string, directory?: string): Promise<boolean> {
		try {
			const { data: result } = await this.client.experimental.workspace.remove({ id, directory });
			return result != null;
		} catch {
			return false;
		}
	}

	// SDK skills endpoint (in addition to filesystem scanning)
	async listSdkSkills(
		directory?: string,
	): Promise<Array<{ name: string; description: string; location: string; content: string }>> {
		try {
			const { data: result } = await this.client.app.skills({ directory });
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

	// Feature: OpenCode Health Check
	async getHealth(): Promise<{ healthy: boolean; version: string } | null> {
		try {
			const { data } = await this.client.global.health();
			return data ?? null;
		} catch {
			return null;
		}
	}

	getPtyWebSocketUrl(ptyId: string, directory?: string): string {
		// Build the WebSocket URL for PTY connection
		// OpenCode exposes PTY I/O at ws://host:port/pty/{id}/connect
		// The /connect suffix is required - it's the WebSocket upgrade endpoint
		const wsUrl = this.baseUrl.replace("http", "ws");
		const baseWsUrl = `${wsUrl}/pty/${ptyId}/connect`;
		if (directory) {
			return `${baseWsUrl}?directory=${encodeURIComponent(directory)}`;
		}
		return baseWsUrl;
	}

	private mapPtySession(pty: any): PtySession {
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

	private mapProject(project: Project): ProjectSummary {
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

	private mapSession(session: Session | GlobalSession): SessionSummary {
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
}
