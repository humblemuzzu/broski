import type { Context } from "@earendil-works/chord";
import type { JsonObject, ToolCall } from "@earendil-works/pi-ai";
import type { Extension, ToolHooks } from "@earendil-works/pi-durable";
import { chordContextModule } from "../../sdk/chord";
import { piDurableModule } from "../../sdk/pi-durable";

export type PiDurablePermissionOutcome = "allow" | "ask" | "deny";

export type PiDurablePermissionDecision = { allow: boolean; reason?: string };

export type PiDurablePermissionRequest = {
	requestId: string;
	sessionId: string;
	toolName: string;
	input: JsonObject;
	title: string;
};

export type PiDurableStoredVerdict = { allow: boolean; reason: string };

export type PiDurablePermissionPolicy = (call: {
	sessionId: string;
	toolName: string;
	input: JsonObject;
}) => PiDurablePermissionOutcome;

export type PiDurablePermissionsOptions = {
	onRequest?: (request: PiDurablePermissionRequest) => void;
	onResolved?: (request: PiDurablePermissionRequest, outcome: "allowed" | "denied") => void;
	policy?: PiDurablePermissionPolicy;
	timeoutMs?: number;
};

const READ_ONLY_TOOLS = new Set(["read", "ls", "list", "grep", "find", "glob", "search", "tree", "webfetch"]);

export const PI_DURABLE_DENY_REASON = "the user denied this tool call";

export const PI_DURABLE_PERMISSION_TIMEOUT_MS = 600_000;

export const PI_DURABLE_PERMISSION_TIMEOUT_REASON = "permission request timed out";

export const defaultPiDurablePermissionPolicy: PiDurablePermissionPolicy = ({ toolName }) =>
	READ_ONLY_TOOLS.has(toolName) ? "allow" : "ask";

function describeToolCall(call: ToolCall): string {
	const path = call.arguments.path;
	const target = typeof path === "string" ? path : undefined;
	switch (call.name) {
		case "bash":
		case "powershell": {
			const command = call.arguments.command;
			return typeof command === "string" ? `Run: ${command}` : "Run a shell command";
		}
		case "read":
			return target === undefined ? "Read a file" : `Read ${target}`;
		case "write":
			return target === undefined ? "Write a file" : `Write ${target}`;
		case "edit":
			return target === undefined ? "Edit a file" : `Edit ${target}`;
		default:
			return `Use ${call.name}`;
	}
}

function hookResult(verdict: PiDurableStoredVerdict): { block: string } | undefined {
	return verdict.allow ? undefined : { block: verdict.reason || PI_DURABLE_DENY_REASON };
}

type PendingPermission = {
	request: PiDurablePermissionRequest;
	resolve(decision: PiDurablePermissionDecision): void;
};

/**
 * The phone as the approval UI: every asked tool call raises one request, and the hook waits for
 * `resolvePermission()` before the call is admitted. The verdict is memoised under the tool task, so a rerun of the
 * same call after a crash reuses it instead of asking again.
 */
export class PiDurablePermissions {
	private readonly pending = new Map<string, PendingPermission>();
	private readonly policy: PiDurablePermissionPolicy;
	private readonly options: PiDurablePermissionsOptions;
	private readonly timeoutMs: number;

	constructor(options: PiDurablePermissionsOptions = {}) {
		this.options = options;
		this.policy = options.policy ?? defaultPiDurablePermissionPolicy;
		this.timeoutMs = options.timeoutMs ?? PI_DURABLE_PERMISSION_TIMEOUT_MS;
	}

	extensionFor(sessionId: string): Extension {
		const beforeTool: ToolHooks["beforeTool"] = async (call, api, context) => {
			const memoKey = `approval:${api.taskId}`;
			const remembered = await api.memo<PiDurableStoredVerdict>(memoKey, context);
			if (remembered !== undefined) return hookResult(remembered);

			const outcome = this.policy({ sessionId, toolName: call.name, input: call.arguments });
			if (outcome !== "ask") {
				const verdict: PiDurableStoredVerdict = {
					allow: outcome === "allow",
					reason: outcome === "allow" ? "" : PI_DURABLE_DENY_REASON,
				};
				await api.memo(memoKey, verdict, context);
				return hookResult(verdict);
			}

			const request: PiDurablePermissionRequest = {
				requestId: `${sessionId}:${call.id}`,
				sessionId,
				toolName: call.name,
				input: call.arguments,
				title: describeToolCall(call),
			};
			const decision = await this.requestDecision(request, context);
			const verdict: PiDurableStoredVerdict = { allow: decision.allow, reason: decision.reason ?? "" };
			await api.memo(memoKey, verdict, context);
			return hookResult(verdict);
		};
		const { defineExtension, hook, ToolTask } = piDurableModule();
		return defineExtension({
			name: "broski-approval",
			hooks: [hook(ToolTask, { beforeTool })],
		});
	}

	resolvePermission(requestId: string, decision: PiDurablePermissionDecision): boolean {
		const pending = this.pending.get(requestId);
		if (pending === undefined) return false;
		this.pending.delete(requestId);
		pending.resolve(decision);
		this.options.onResolved?.(pending.request, decision.allow ? "allowed" : "denied");
		return true;
	}

	pendingFor(sessionId: string): PiDurablePermissionRequest[] {
		const requests: PiDurablePermissionRequest[] = [];
		for (const pending of this.pending.values()) {
			if (pending.request.sessionId === sessionId) requests.push(pending.request);
		}
		return requests;
	}

	private async requestDecision(
		request: PiDurablePermissionRequest,
		context: Context,
	): Promise<PiDurablePermissionDecision> {
		const promise = new Promise<PiDurablePermissionDecision>((resolve) => {
			this.pending.set(request.requestId, { request, resolve });
		});
		const timer = setTimeout(() => this.expirePermission(request.requestId), this.timeoutMs);
		timer.unref?.();
		this.options.onRequest?.(request);
		try {
			return await chordContextModule().awaitWithContext(promise, context);
		} finally {
			clearTimeout(timer);
			this.pending.delete(request.requestId);
		}
	}

	private expirePermission(requestId: string): void {
		const pending = this.pending.get(requestId);
		if (pending === undefined) return;
		this.pending.delete(requestId);
		pending.resolve({ allow: false, reason: PI_DURABLE_PERMISSION_TIMEOUT_REASON });
		this.options.onResolved?.(pending.request, "denied");
	}
}
