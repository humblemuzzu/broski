import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import { PiDurableHarnessHost, type PiDurableModelChoice, PiDurablePermissions } from "../../connectors/pi-durable";
import { handle, handleUnified } from "../../handlers/pi_durable";
import type { PiDurableDeps } from "../../handlers/pi_durable/host";
import { broadcastPiDurablePermission } from "../../handlers/pi_durable/transport";
import type { ServerMessage } from "../../types";
import type { PiDurableSocket } from "../../types/pi-durable";

export const faux = fauxProvider({ models: [{ id: "faux-1", name: "Faux One" }] });
export const models = createModels();
models.setProvider(faux.provider);

export const MODEL = { provider: "faux", modelId: "faux-1" };

export class Collector implements PiDurableSocket {
	readonly messages: ServerMessage[] = [];

	send(payload: string): number {
		this.messages.push(JSON.parse(payload) as ServerMessage);
		return payload.length;
	}
}

export type Harness = {
	host: PiDurableHarnessHost;
	deps: PiDurableDeps;
	projectDir: string;
	socket: Collector;
};

function modelChoice(): PiDurableModelChoice {
	return {
		provider: MODEL.provider,
		modelId: MODEL.modelId,
		label: "Faux One",
		contextWindow: 0,
		supportsReasoning: false,
	};
}

export function createHarness(options: { idleTimeoutMs?: number } = {}): Harness {
	const root = mkdtempSync(join(tmpdir(), "pi-durable-handler-"));
	const projectDir = mkdtempSync(join(tmpdir(), "pi-durable-handler-project-"));
	const host = new PiDurableHarnessHost({
		models,
		root,
		defaultModel: MODEL,
		idleTimeoutMs: options.idleTimeoutMs ?? 60_000,
		permissions: new PiDurablePermissions({ onRequest: (request) => broadcastPiDurablePermission(request) }),
	});
	const deps: PiDurableDeps = {
		host: async () => host,
		listModels: async () => [modelChoice()],
		resolveModel: async (provider, modelId) =>
			provider === MODEL.provider && modelId === MODEL.modelId ? modelChoice() : undefined,
	};
	return { host, deps, projectDir, socket: new Collector() };
}

function collect(harness: Harness): (reply: ServerMessage) => void {
	return (reply) => {
		harness.socket.messages.push(reply);
	};
}

export async function send(harness: Harness, message: Record<string, unknown>): Promise<void> {
	await handle(harness.socket, message, collect(harness), harness.deps);
}

export async function sendUnified(harness: Harness, message: Record<string, unknown>): Promise<void> {
	await handleUnified(message, collect(harness), harness.deps);
}

export function requireMessage<T extends ServerMessage["type"]>(
	harness: Harness,
	type: T,
): Extract<ServerMessage, { type: T }> {
	for (let index = harness.socket.messages.length - 1; index >= 0; index -= 1) {
		const message = harness.socket.messages[index];
		if (message !== undefined && message.type === type) return message as Extract<ServerMessage, { type: T }>;
	}
	throw new Error(`no ${type} message was sent`);
}

export function runtimeEventTypes(harness: Harness): string[] {
	return harness.socket.messages.flatMap((message) =>
		message.type === "runtime_event" ? [String(message.data.type)] : [],
	);
}

export function runtimeStates(harness: Harness) {
	return harness.socket.messages.flatMap((message) => (message.type === "runtime_state" ? [message.data] : []));
}

export function permissionRequests(harness: Harness) {
	return harness.socket.messages.flatMap((message) =>
		message.type === "runtime_event" && message.data.type === "permission_requested" ? [message.data.request] : [],
	);
}

export function transcriptOf(harness: Harness) {
	return requireMessage(harness, "pd_transcript").data.messages;
}

export async function waitFor(
	predicate: () => boolean | Promise<boolean>,
	label: string,
	timeoutMs = 15_000,
): Promise<void> {
	const startedAt = Date.now();
	while (!(await predicate())) {
		if (Date.now() - startedAt > timeoutMs) throw new Error(`timed out waiting for ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

export function resumedCounts(event: { payload: unknown }): { tasks: number; submissions: number } {
	const payload = event.payload;
	if (typeof payload !== "object" || payload === null) return { tasks: 0, submissions: 0 };
	return {
		tasks: "tasks" in payload && typeof payload.tasks === "number" ? payload.tasks : 0,
		submissions: "submissions" in payload && typeof payload.submissions === "number" ? payload.submissions : 0,
	};
}

export async function createSession(harness: Harness, extra: Record<string, unknown> = {}): Promise<string> {
	await send(harness, {
		type: "pd_create_session",
		cwd: harness.projectDir,
		model: MODEL,
		requestId: "create-1",
		...extra,
	});
	return requireMessage(harness, "pd_session_created").data.id;
}
