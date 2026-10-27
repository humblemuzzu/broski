/**
 * A real bridge, a real Pi AgentSession and a scripted model behind a unix link socket: everything the phone
 * would see for one Pi chat, captured as the runtime events the bridge sends it.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BroskiRuntimeEvent } from "../../types/runtime";
import { type BridgeHandle, E2E_WAIT_MS, setupTestEnv, type TestEnv } from "../e2e/harness";
import { connectUnixWs, type LinkFrame, type UnixWsClient } from "../link/unix-ws";
import { CMD_BASH_EXTENSION } from "./pi-cmd-bash-extension";
import {
	type ScriptedProvider,
	type ScriptedTurn,
	serveScriptedProvider,
	writeScriptedModels,
} from "./scripted-openai-server";

const DEVICE_HEADERS = {
	"x-broski-device-id": "0123456789abcdef0123456789abcdef",
	"x-broski-device-name": "Rig Phone",
	"x-broski-role": "owner",
};

export type PiLiveRigOptions = {
	turns: ScriptedTurn[];
	/** Replace the built-in bash tool with one that takes `cmd`, like a user's own tools extension. */
	cmdBash?: boolean;
};

export type PiLiveRig = {
	env: TestEnv;
	repo: string;
	client: UnixWsClient;
	scripted: ScriptedProvider;
	bridge: BridgeHandle;
	/** A second phone on the same bridge. */
	connectDevice: (deviceId: string) => Promise<UnixWsClient>;
	/** `pi_new_session` for the repo with the scripted model; resolves with the new session's id. */
	newSession: (client?: UnixWsClient) => Promise<string>;
	/** `set_view` as the app sends it once it knows the session id. */
	view: (sessionId: string, client?: UnixWsClient) => void;
	/** `pi_chat`, resolving once the bridge acknowledged it. */
	chat: (prompt: string, client?: UnixWsClient) => Promise<void>;
	abort: (client?: UnixWsClient) => Promise<void>;
	stop: () => Promise<void>;
};

/** Every runtime event a client received, in order, with `batch` envelopes opened. */
export function runtimeEventsOf(client: UnixWsClient): BroskiRuntimeEvent[] {
	return framesOf(client)
		.filter((frame) => frame.type === "runtime_event")
		.map((frame) => frame.data as BroskiRuntimeEvent);
}

export function framesOf(client: UnixWsClient): LinkFrame[] {
	return client.frames().flatMap((frame) => (frame.type === "batch" ? (frame.messages as LinkFrame[]) : [frame]));
}

export function waitForEvent(
	client: UnixWsClient,
	type: BroskiRuntimeEvent["type"],
	timeoutMs = E2E_WAIT_MS,
): Promise<LinkFrame> {
	return client.waitForWhere(
		(frame) =>
			frame.type === "batch"
				? (frame.messages as LinkFrame[]).some((inner) => isRuntimeEvent(inner, type))
				: isRuntimeEvent(frame, type),
		type,
		timeoutMs,
	);
}

function isRuntimeEvent(frame: LinkFrame, type: string): boolean {
	return frame.type === "runtime_event" && (frame.data as BroskiRuntimeEvent).type === type;
}

function initRepo(root: string): string {
	const repo = join(realpathSync(root), "repo");
	mkdirSync(repo, { recursive: true });
	execFileSync("git", ["init", "-q", repo]);
	return repo;
}

export async function startPiLiveRig(options: PiLiveRigOptions): Promise<PiLiveRig> {
	const env = setupTestEnv();
	const repo = initRepo(env.home);
	const scripted = serveScriptedProvider(options.turns);
	writeScriptedModels(env.piAgentDir, scripted);
	if (options.cmdBash) {
		mkdirSync(join(env.piAgentDir, "extensions"), { recursive: true });
		writeFileSync(join(env.piAgentDir, "extensions", "cmd-bash.ts"), CMD_BASH_EXTENSION);
	}

	const { startBridge } = await import("../e2e/harness");
	const socketPath = join(realpathSync(env.home), "link.sock");
	const bridge = await startBridge({ linkSocket: socketPath });
	const clients: UnixWsClient[] = [];
	const connectDevice = async (deviceId: string): Promise<UnixWsClient> => {
		const device = await connectUnixWs(socketPath, { ...DEVICE_HEADERS, "x-broski-device-id": deviceId });
		clients.push(device);
		return device;
	};
	const client = await connectDevice(DEVICE_HEADERS["x-broski-device-id"]);

	let requestCounter = 0;
	const request = async (on: UnixWsClient, message: Record<string, unknown>): Promise<LinkFrame> => {
		const requestId = `rig-${requestCounter++}`;
		on.send({ ...message, requestId });
		return on.waitForWhere((frame) => frame.requestId === requestId, String(message.type));
	};

	return {
		env,
		repo,
		client,
		scripted,
		bridge,
		connectDevice,
		newSession: async (on = client) => {
			await request(on, {
				type: "pi_new_session",
				projectPath: repo,
				provider: scripted.provider,
				modelId: scripted.modelId,
				thinkingLevel: "high",
			});
			const state = await request(on, { type: "pi_get_state", projectPath: repo });
			return (state.data as { sessionId: string }).sessionId;
		},
		view: (sessionId, on = client) => on.send({ type: "set_view", agent: "pi", sessionId }),
		chat: async (prompt, on = client) => {
			await request(on, { type: "pi_chat", projectPath: repo, prompt });
		},
		abort: async (on = client) => {
			await request(on, { type: "pi_abort", projectPath: repo });
		},
		stop: async () => {
			for (const device of clients) device.close();
			scripted.stop();
			await bridge.stop();
			env.restore();
		},
	};
}
