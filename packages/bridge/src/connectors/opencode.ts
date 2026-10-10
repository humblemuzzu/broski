import type {
	Auth,
	FilePartSource,
	GlobalEvent,
	Config as OpenCodeConfig,
	PermissionRequest as OpenCodePermissionRequest,
	QuestionRequest as OpenCodeQuestionRequest,
	Workspace as OpenCodeWorkspace,
	OpencodeClient,
	OutputFormat,
	Part,
	Project,
	SessionMessageResponse,
} from "@opencode-ai/sdk/v2";
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
import * as agentsDomain from "./opencode/agents";
import * as configDomain from "./opencode/config";
import { createOpenCodeClient, createOpenCodeContext, type OpenCodeContext } from "./opencode/context";
import * as eventsDomain from "./opencode/events";
import * as filesDomain from "./opencode/files";
import * as instanceDomain from "./opencode/instance";
import * as lspDomain from "./opencode/lsp";
import * as mcpDomain from "./opencode/mcp";
import * as messagesDomain from "./opencode/messages";
import * as permissionsDomain from "./opencode/permissions";
import * as projectsDomain from "./opencode/projects";
import * as ptyDomain from "./opencode/pty";
import * as sessionContextDomain from "./opencode/session-context";
import type { OpenCodeSessionListOptions } from "./opencode/session-list";
import * as sessionsDomain from "./opencode/sessions";
import * as toolsDomain from "./opencode/tools";
import * as vcsDomain from "./opencode/vcs";
import * as worktreesDomain from "./opencode/worktrees";

export type OpenCodeConnectorOptions = {
	baseUrl?: string;
	client?: OpencodeClient;
};

export class OpenCodeConnector {
	private ctx: OpenCodeContext;

	constructor(options: OpenCodeConnectorOptions = {}) {
		this.ctx = createOpenCodeContext(options.baseUrl, options.client);
	}

	// Update the base URL (useful for dynamic port discovery)
	updateBaseUrl(newBaseUrl: string) {
		this.ctx.baseUrl = newBaseUrl;
		this.ctx.client = createOpenCodeClient(newBaseUrl);
	}

	get url(): string {
		return this.ctx.baseUrl;
	}

	async isRunning(): Promise<boolean> {
		return instanceDomain.isRunning(this.ctx);
	}

	// Get the current OpenCode instance directory
	async getInstanceDirectory(): Promise<string | null> {
		return instanceDomain.getInstanceDirectory(this.ctx);
	}

	async listProjects(): Promise<ProjectSummary[]> {
		return projectsDomain.listProjects(this.ctx);
	}

	async listSessions(directory?: string, options?: OpenCodeSessionListOptions): Promise<SessionSummary[]> {
		return sessionsDomain.listSessions(this.ctx, directory, options);
	}

	invalidateSessionCache(directory?: string): void {
		sessionsDomain.invalidateSessionCache(this.ctx, directory);
	}

	async createSession(
		directory?: string,
		title?: string,
		permission?: PermissionRuleset,
		workspaceID?: string,
	): Promise<SessionSummary> {
		return sessionsDomain.createSession(this.ctx, directory, title, permission, workspaceID);
	}

	async getSession(sessionId: string, directory?: string): Promise<SessionSummary> {
		return sessionsDomain.getSession(this.ctx, sessionId, directory);
	}

	async getSessionMessages(sessionId: string, directory?: string, limit?: number, before?: string) {
		return messagesDomain.getSessionMessages(this.ctx, sessionId, directory, limit, before);
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
		return messagesDomain.sendPrompt(
			this.ctx,
			sessionId,
			content,
			directory,
			messageId,
			model,
			agent,
			fileAttachments,
			variant,
			noReply,
			system,
		);
	}

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
		return messagesDomain.sendPromptAsync(
			this.ctx,
			sessionId,
			content,
			directory,
			model,
			agent,
			fileAttachments,
			variant,
			noReply,
			system,
			format,
		);
	}

	async abortSession(sessionId: string, directory?: string): Promise<boolean> {
		return sessionsDomain.abortSession(this.ctx, sessionId, directory);
	}

	async getSessionDiff(sessionId: string, directory?: string, messageId?: string) {
		return sessionsDomain.getSessionDiff(this.ctx, sessionId, directory, messageId);
	}

	async listFiles(path: string, directory?: string) {
		return filesDomain.listFiles(this.ctx, path, directory);
	}

	async listProviders() {
		return configDomain.listProviders(this.ctx);
	}

	async getConfig(directory?: string) {
		return configDomain.getConfig(this.ctx, directory);
	}

	async getConfigForDirectory(directory?: string) {
		return configDomain.getConfigForDirectory(this.ctx, directory);
	}

	async updateConfig(config: OpenCodeConfig, directory?: string) {
		return configDomain.updateConfig(this.ctx, config, directory);
	}

	async updateModel(model: string, directory?: string) {
		return configDomain.updateModel(this.ctx, model, directory);
	}

	async respondToPermission(
		requestId: string,
		response: "once" | "always" | "reject",
		message?: string,
		directory?: string,
	): Promise<boolean> {
		return permissionsDomain.respondToPermission(this.ctx, requestId, response, message, directory);
	}

	async listPendingPermissions(directory?: string): Promise<OpenCodePermissionRequest[]> {
		return permissionsDomain.listPendingPermissions(this.ctx, directory);
	}

	async listPendingQuestions(directory?: string): Promise<OpenCodeQuestionRequest[]> {
		return permissionsDomain.listPendingQuestions(this.ctx, directory);
	}

	async replyToQuestion(requestId: string, answers: string[][], directory?: string): Promise<boolean> {
		return permissionsDomain.replyToQuestion(this.ctx, requestId, answers, directory);
	}

	async rejectQuestion(requestId: string, directory?: string): Promise<boolean> {
		return permissionsDomain.rejectQuestion(this.ctx, requestId, directory);
	}

	async startEventStream(onEvent: (event: GlobalEvent) => void): Promise<AbortController> {
		return eventsDomain.startEventStream(this.ctx, onEvent);
	}

	async getLspStatus(directory?: string): Promise<LspServerStatus[]> {
		return lspDomain.getLspStatus(this.ctx, directory);
	}

	async disposeInstance(directory?: string): Promise<boolean> {
		return instanceDomain.disposeInstance(this.ctx, directory);
	}

	async getSessionContext(sessionId: string, directory?: string): Promise<SessionContextInfo> {
		return sessionContextDomain.getSessionContext(this.ctx, sessionId, directory);
	}

	// Feature 1: Todo/Plan Management
	async getTodos(sessionId: string, directory?: string): Promise<Todo[]> {
		return messagesDomain.getTodos(this.ctx, sessionId, directory);
	}

	// Feature 2: Slash Commands
	async listCommands(directory?: string): Promise<Command[]> {
		return agentsDomain.listCommands(this.ctx, directory);
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
		return messagesDomain.executeCommand(this.ctx, sessionId, command, args, directory, agent, model, variant, parts);
	}

	// Feature 3: Agent Switching
	async listAgents(directory?: string): Promise<Agent[]> {
		return agentsDomain.listAgents(this.ctx, directory);
	}

	// Feature 4: Session Delete
	async deleteSession(sessionId: string, directory?: string): Promise<boolean> {
		return sessionsDomain.deleteSession(this.ctx, sessionId, directory);
	}

	// Feature 5: Session Update (Rename)
	async updateSession(
		sessionId: string,
		title?: string,
		archived?: boolean,
		directory?: string,
	): Promise<SessionSummary> {
		return sessionsDomain.updateSession(this.ctx, sessionId, title, archived, directory);
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
		return messagesDomain.shellCommand(this.ctx, sessionId, command, directory, agent, model, messageId);
	}

	async forkSession(sessionId: string, messageId?: string, directory?: string): Promise<SessionSummary> {
		return sessionsDomain.forkSession(this.ctx, sessionId, messageId, directory);
	}

	async listSessionChildren(sessionId: string, directory?: string): Promise<SessionSummary[]> {
		return sessionsDomain.listSessionChildren(this.ctx, sessionId, directory);
	}

	// Feature 7: Message Revert (Undo)
	async revertMessage(
		sessionId: string,
		messageId: string,
		partId?: string,
		directory?: string,
	): Promise<SessionSummary> {
		return sessionsDomain.revertMessage(this.ctx, sessionId, messageId, partId, directory);
	}

	async unrevertSession(sessionId: string, directory?: string): Promise<SessionSummary> {
		return sessionsDomain.unrevertSession(this.ctx, sessionId, directory);
	}

	// Feature 8: Session Share
	async shareSession(sessionId: string, directory?: string): Promise<SessionSummary> {
		return sessionsDomain.shareSession(this.ctx, sessionId, directory);
	}

	async unshareSession(sessionId: string, directory?: string): Promise<SessionSummary> {
		return sessionsDomain.unshareSession(this.ctx, sessionId, directory);
	}

	// Feature 9: Session Summarize (Compact)
	async summarizeSession(
		sessionId: string,
		providerID: string,
		modelID: string,
		directory?: string,
		auto?: boolean,
	): Promise<boolean> {
		return sessionsDomain.summarizeSession(this.ctx, sessionId, providerID, modelID, directory, auto);
	}

	// Feature 10: Git/VCS Information
	async getVcsInfo(directory?: string): Promise<VcsInfo> {
		return vcsDomain.getVcsInfo(this.ctx, directory);
	}

	// Feature 10b: VCS Diff (working tree or vs default branch)
	async getVcsDiff(mode: "git" | "branch", directory?: string): Promise<VcsDiffFile[]> {
		return vcsDomain.getVcsDiff(this.ctx, mode, directory);
	}

	// Feature 11: File Content Read
	async readFile(path: string, directory?: string): Promise<FileContent> {
		return filesDomain.readFile(this.ctx, path, directory);
	}

	// Feature 12: File Search - Find files by name
	async findFiles(query: string, directory?: string): Promise<string[]> {
		return filesDomain.findFiles(this.ctx, query, directory);
	}

	// Feature 12b: File Search - Find files AND directories (for @ autocomplete)
	async searchFilesAndDirs(query: string, directory?: string, limit: number = 20): Promise<string[]> {
		return filesDomain.searchFilesAndDirs(this.ctx, query, directory, limit);
	}

	// Feature 12: File Search - Find text in files (ripgrep)
	async findText(pattern: string, include?: string, directory?: string): Promise<TextSearchResult[]> {
		return filesDomain.findText(this.ctx, pattern, include, directory);
	}

	// Feature 12: File Search - Find symbols (LSP)
	async findSymbols(query: string, directory?: string): Promise<SymbolResult[]> {
		return filesDomain.findSymbols(this.ctx, query, directory);
	}

	// Feature 13: Session Status
	async getSessionStatus(directory?: string): Promise<Record<string, SessionStatusInfo>> {
		return sessionsDomain.getSessionStatus(this.ctx, directory);
	}

	// Feature 14: PTY Terminal Sessions - List
	async listPty(directory?: string): Promise<PtySession[]> {
		return ptyDomain.listPty(this.ctx, directory);
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
		return ptyDomain.createPty(this.ctx, command, args, cwd, title, env, directory);
	}

	// Feature 14: PTY Terminal Sessions - Get
	async getPty(ptyId: string, directory?: string): Promise<PtySession | null> {
		return ptyDomain.getPty(this.ctx, ptyId, directory);
	}

	// Feature 14: PTY Terminal Sessions - Update
	async updatePty(
		ptyId: string,
		title?: string,
		rows?: number,
		cols?: number,
		directory?: string,
	): Promise<PtySession | null> {
		return ptyDomain.updatePty(this.ctx, ptyId, title, rows, cols, directory);
	}

	// Feature 14: PTY Terminal Sessions - Delete
	async deletePty(ptyId: string, directory?: string): Promise<boolean> {
		return ptyDomain.deletePty(this.ctx, ptyId, directory);
	}

	// Feature 15: MCP Server Management - Status
	async getMcpStatus(directory?: string): Promise<Record<string, McpServerStatus>> {
		return mcpDomain.getMcpStatus(this.ctx, directory);
	}

	// Feature 15: MCP Server Management - Add
	async addMcp(
		name: string,
		config: Record<string, unknown>,
		directory?: string,
	): Promise<Record<string, McpServerStatus>> {
		return mcpDomain.addMcp(this.ctx, name, config, directory);
	}

	// Feature 15: MCP Server Management - Connect
	async connectMcp(name: string, directory?: string): Promise<boolean> {
		return mcpDomain.connectMcp(this.ctx, name, directory);
	}

	// Feature 15: MCP Server Management - Disconnect
	async disconnectMcp(name: string, directory?: string): Promise<boolean> {
		return mcpDomain.disconnectMcp(this.ctx, name, directory);
	}

	// Feature 15c: MCP OAuth Authentication
	async mcpAuthStart(name: string, directory?: string): Promise<{ authorizationUrl: string } | null> {
		return mcpDomain.mcpAuthStart(this.ctx, name, directory);
	}

	async mcpAuthCallback(name: string, code: string, directory?: string): Promise<boolean> {
		return mcpDomain.mcpAuthCallback(this.ctx, name, code, directory);
	}

	async mcpAuthAuthenticate(name: string, directory?: string): Promise<Record<string, unknown> | null> {
		return mcpDomain.mcpAuthAuthenticate(this.ctx, name, directory);
	}

	async mcpAuthRemove(name: string, directory?: string): Promise<boolean> {
		return mcpDomain.mcpAuthRemove(this.ctx, name, directory);
	}

	// Feature 15b: MCP Resources (SDK v1.1.1+ experimental)
	async getMcpResources(directory?: string): Promise<Record<string, McpResource>> {
		return mcpDomain.getMcpResources(this.ctx, directory);
	}

	// Feature 23: Git Worktrees (SDK v1.1.1+ experimental)
	async listWorktrees(directory?: string): Promise<Worktree[]> {
		return worktreesDomain.listWorktrees(this.ctx, directory);
	}

	async createWorktree(name?: string, startCommand?: string, directory?: string): Promise<Worktree | null> {
		return worktreesDomain.createWorktree(this.ctx, name, startCommand, directory);
	}

	async resetWorktree(worktreeDirectory: string, directory?: string): Promise<boolean> {
		return worktreesDomain.resetWorktree(this.ctx, worktreeDirectory, directory);
	}

	async deleteWorktree(worktreeDirectory: string, directory?: string): Promise<boolean> {
		return worktreesDomain.deleteWorktree(this.ctx, worktreeDirectory, directory);
	}

	// Feature 16: Full Provider Management - List all providers
	async listAllProviders(directory?: string): Promise<ProviderInfo> {
		return configDomain.listAllProviders(this.ctx, directory);
	}

	// Feature 16: Full Provider Management - Get auth methods
	async getProviderAuth(directory?: string): Promise<Record<string, ProviderAuthMethod[]>> {
		return configDomain.getProviderAuth(this.ctx, directory);
	}

	async providerOauthAuthorize(
		providerId: string,
		method: number,
		directory?: string,
		inputs?: Record<string, string>,
	): Promise<ProviderAuthAuthorization | null> {
		return configDomain.providerOauthAuthorize(this.ctx, providerId, method, directory, inputs);
	}

	async providerOauthCallback(providerId: string, method: number, code?: string, directory?: string): Promise<boolean> {
		return configDomain.providerOauthCallback(this.ctx, providerId, method, code, directory);
	}

	// Feature 17: Tool List - Get tool IDs
	async listToolIds(directory?: string): Promise<string[]> {
		return toolsDomain.listToolIds(this.ctx, directory);
	}

	// Feature 17: Tool List - Get tools with details
	async listTools(provider: string, model: string, directory?: string): Promise<ToolInfo[]> {
		return toolsDomain.listTools(this.ctx, provider, model, directory);
	}

	// Feature 18: File Status (Git)
	async getFileStatus(directory?: string): Promise<FileStatusInfo[]> {
		return filesDomain.getFileStatus(this.ctx, directory);
	}

	// Feature 19: Formatter Status
	async getFormatterStatus(directory?: string): Promise<FormatterInfo[]> {
		return toolsDomain.getFormatterStatus(this.ctx, directory);
	}

	// Feature 20: Session Init (Create AGENTS.md)
	async initSession(
		sessionId: string,
		providerID: string,
		modelID: string,
		messageID: string,
		directory?: string,
	): Promise<boolean> {
		return sessionsDomain.initSession(this.ctx, sessionId, providerID, modelID, messageID, directory);
	}

	// Provider credential management
	async authSet(providerId: string, auth: Auth): Promise<boolean> {
		return configDomain.authSet(this.ctx, providerId, auth);
	}

	async authRemove(providerId: string): Promise<boolean> {
		return configDomain.authRemove(this.ctx, providerId);
	}

	// Global config
	async getGlobalConfig(): Promise<Record<string, unknown>> {
		return configDomain.getGlobalConfig(this.ctx);
	}

	async updateGlobalConfig(config: OpenCodeConfig): Promise<Record<string, unknown>> {
		return configDomain.updateGlobalConfig(this.ctx, config);
	}

	// Project management
	async getCurrentProject(directory?: string): Promise<Project | null> {
		return projectsDomain.getCurrentProject(this.ctx, directory);
	}

	async updateProject(
		projectId: string,
		updates: { name?: string; icon?: Record<string, unknown> },
		directory?: string,
	): Promise<Project | null> {
		return projectsDomain.updateProject(this.ctx, projectId, updates, directory);
	}

	async initGit(directory?: string): Promise<any> {
		return projectsDomain.initGit(this.ctx, directory);
	}

	async getPaths(directory?: string): Promise<any> {
		return projectsDomain.getPaths(this.ctx, directory);
	}

	// Message part editing
	async deletePart(sessionId: string, messageId: string, partId: string, directory?: string): Promise<boolean> {
		return messagesDomain.deletePart(this.ctx, sessionId, messageId, partId, directory);
	}

	async updatePart(
		sessionId: string,
		messageId: string,
		partId: string,
		part: Part,
		directory?: string,
	): Promise<Part | null> {
		return messagesDomain.updatePart(this.ctx, sessionId, messageId, partId, part, directory);
	}

	async deleteMessage(sessionId: string, messageId: string, directory?: string): Promise<boolean> {
		return messagesDomain.deleteMessage(this.ctx, sessionId, messageId, directory);
	}

	async getMessage(sessionId: string, messageId: string, directory?: string): Promise<SessionMessageResponse | null> {
		return messagesDomain.getMessage(this.ctx, sessionId, messageId, directory);
	}

	async listWorkspaces(directory?: string): Promise<OpenCodeWorkspace[]> {
		return worktreesDomain.listWorkspaces(this.ctx, directory);
	}

	async createWorkspace(
		id: string,
		options: { branch?: string | null; config?: { directory: string; type: "worktree" } },
		directory?: string,
	): Promise<OpenCodeWorkspace | null> {
		return worktreesDomain.createWorkspace(this.ctx, id, options, directory);
	}

	async removeWorkspace(id: string, directory?: string): Promise<boolean> {
		return worktreesDomain.removeWorkspace(this.ctx, id, directory);
	}

	// SDK skills endpoint (in addition to filesystem scanning)
	async listSdkSkills(
		directory?: string,
	): Promise<Array<{ name: string; description: string; location: string; content: string }>> {
		return agentsDomain.listSdkSkills(this.ctx, directory);
	}

	// Feature: OpenCode Health Check
	async getHealth(): Promise<{ healthy: boolean; version: string } | null> {
		return instanceDomain.getHealth(this.ctx);
	}

	getPtyWebSocketUrl(ptyId: string, directory?: string): string {
		return ptyDomain.getPtyWebSocketUrl(this.ctx, ptyId, directory);
	}
}
