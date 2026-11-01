/**
 * A scripted `Query` for unit tests of the hosts, the probe and the ops: the test pushes frames and ends the stream;
 * every control call is recorded, answered by `handlers` when given, else rejected as not scripted.
 */

import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

type Control = Omit<Query, keyof AsyncGenerator<SDKMessage, void>>;
type ControlName = keyof Control;

export interface ControlCall {
	readonly method: ControlName;
	readonly args: readonly unknown[];
}

export class FakeQuery implements Query {
	readonly calls: ControlCall[] = [];
	closed = false;
	private readonly frames: SDKMessage[] = [];
	private wake: (() => void) | undefined;
	private ended = false;
	private readonly stream: AsyncGenerator<SDKMessage, void>;

	constructor(private readonly handlers: Partial<Control> = {}) {
		this.stream = this.read();
	}

	push(...frames: SDKMessage[]): void {
		this.frames.push(...frames);
		this.notify();
	}

	end(): void {
		this.ended = true;
		this.notify();
	}

	next(...args: [] | [unknown]) {
		return this.stream.next(...args);
	}

	return(value: undefined) {
		this.end();
		return this.stream.return(value);
	}

	throw(error: unknown) {
		return this.stream.throw(error);
	}

	[Symbol.asyncIterator]() {
		return this;
	}

	async [Symbol.asyncDispose]() {
		this.close();
	}

	interrupt: Query["interrupt"] = (...args) => this.control("interrupt", args, this.handlers.interrupt);
	setPermissionMode: Query["setPermissionMode"] = (...args) =>
		this.control("setPermissionMode", args, this.handlers.setPermissionMode);
	setMcpPermissionModeOverride: Query["setMcpPermissionModeOverride"] = (...args) =>
		this.control("setMcpPermissionModeOverride", args, this.handlers.setMcpPermissionModeOverride);
	setModel: Query["setModel"] = (...args) => this.control("setModel", args, this.handlers.setModel);
	setMaxThinkingTokens: Query["setMaxThinkingTokens"] = (...args) =>
		this.control("setMaxThinkingTokens", args, this.handlers.setMaxThinkingTokens);
	applyFlagSettings: Query["applyFlagSettings"] = (...args) =>
		this.control("applyFlagSettings", args, this.handlers.applyFlagSettings);
	updateSettings: Query["updateSettings"] = (...args) =>
		this.control("updateSettings", args, this.handlers.updateSettings);
	initializationResult: Query["initializationResult"] = (...args) =>
		this.control("initializationResult", args, this.handlers.initializationResult);
	reinitialize: Query["reinitialize"] = (...args) => this.control("reinitialize", args, this.handlers.reinitialize);
	supportedCommands: Query["supportedCommands"] = (...args) =>
		this.control("supportedCommands", args, this.handlers.supportedCommands);
	supportedModels: Query["supportedModels"] = (...args) =>
		this.control("supportedModels", args, this.handlers.supportedModels);
	supportedAgents: Query["supportedAgents"] = (...args) =>
		this.control("supportedAgents", args, this.handlers.supportedAgents);
	mcpServerStatus: Query["mcpServerStatus"] = (...args) =>
		this.control("mcpServerStatus", args, this.handlers.mcpServerStatus);
	getContextUsage: Query["getContextUsage"] = (...args) =>
		this.control("getContextUsage", args, this.handlers.getContextUsage);
	usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: Query["usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET"] =
		(...args) =>
			this.control(
				"usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET",
				args,
				this.handlers.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET,
			);
	readFile: Query["readFile"] = (...args) => this.control("readFile", args, this.handlers.readFile);
	reloadPlugins: Query["reloadPlugins"] = (...args) => this.control("reloadPlugins", args, this.handlers.reloadPlugins);
	reloadSkills: Query["reloadSkills"] = (...args) => this.control("reloadSkills", args, this.handlers.reloadSkills);
	reloadOutputStyles: Query["reloadOutputStyles"] = (...args) =>
		this.control("reloadOutputStyles", args, this.handlers.reloadOutputStyles);
	accountInfo: Query["accountInfo"] = (...args) => this.control("accountInfo", args, this.handlers.accountInfo);
	rewindFiles: Query["rewindFiles"] = (...args) => this.control("rewindFiles", args, this.handlers.rewindFiles);
	seedReadState: Query["seedReadState"] = (...args) => this.control("seedReadState", args, this.handlers.seedReadState);
	reconnectMcpServer: Query["reconnectMcpServer"] = (...args) =>
		this.control("reconnectMcpServer", args, this.handlers.reconnectMcpServer);
	toggleMcpServer: Query["toggleMcpServer"] = (...args) =>
		this.control("toggleMcpServer", args, this.handlers.toggleMcpServer);
	readMcpResource: Query["readMcpResource"] = (...args) =>
		this.control("readMcpResource", args, this.handlers.readMcpResource);
	setMcpServers: Query["setMcpServers"] = (...args) => this.control("setMcpServers", args, this.handlers.setMcpServers);
	streamInput: Query["streamInput"] = (...args) => this.control("streamInput", args, this.handlers.streamInput);
	stopTask: Query["stopTask"] = (...args) => this.control("stopTask", args, this.handlers.stopTask);
	backgroundTasks: Query["backgroundTasks"] = (...args) =>
		this.control("backgroundTasks", args, this.handlers.backgroundTasks);

	close(): void {
		this.calls.push({ method: "close", args: [] });
		this.closed = true;
		this.end();
	}

	private control<A extends unknown[], R>(
		method: ControlName,
		args: A,
		handler: ((...args: A) => Promise<R>) | undefined,
	): Promise<R> {
		this.calls.push({ method, args });
		return handler ? handler(...args) : Promise.reject(new Error(`FakeQuery: ${method} is not scripted`));
	}

	private notify(): void {
		const resume = this.wake;
		this.wake = undefined;
		resume?.();
	}

	private async *read(): AsyncGenerator<SDKMessage, void> {
		for (;;) {
			const next = this.frames.shift();
			if (next) {
				yield next;
				continue;
			}
			if (this.ended) return;
			await new Promise<void>((resolve) => {
				this.wake = resolve;
			});
		}
	}
}
