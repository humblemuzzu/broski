/**
 * Shared plumbing for the daemon-decision tests: one real bridge on a link socket, the per-backend
 * entry points the feed taps, and the waits a decision's assertions use.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCodeConnector } from "../../connectors/opencode";
import type { PiDurablePermissionRequest } from "../../connectors/pi-durable";
import { broadcastPiDurablePermission } from "../../handlers/pi_durable/transport";
import { createLimits } from "../../server/limits";
import { resetLinkFeed } from "../../server/link-feed/feed";
import { createLeveledLogger } from "../../server/logger";
import { createOpenCodeEvents } from "../../server/opencode-events";
import { createBridgeState } from "../../server/state";
import { createStreams } from "../../server/streams";
import type { ClaudeCodeStreamMessage } from "../../types/claude-code-stream-message";
import type { CodexStreamMessage } from "../../types/codex";
import { setupTestEnv, startBridge } from "../e2e/harness";
import { makeClient, type RecordedCall } from "../fixtures/oc-connector-harness";
import type { LinkFrame, UnixWsClient } from "./unix-ws";

const CWD = "/Users/dev/broski";

export type DecisionRequest = { backend: string; session: string; request: string; decision: "allow" | "deny" };

export type DecisionHarness = {
	socketPath: string;
	ccStream: (message: ClaudeCodeStreamMessage, sessionId: string, cwd?: string) => void;
	cxStream: (message: CodexStreamMessage, threadId: string) => void;
	ocStream: (payloadType: string, properties: Record<string, unknown>) => void;
	durablePermission: (sessionId: string, requestId: string) => void;
	alertFor: (feed: UnixWsClient, backend: string, session: string) => Promise<LinkFrame>;
	/** Sends one decision and returns its result; earlier frames are dropped so a repeat cannot match. */
	decide: (feed: UnixWsClient, input: DecisionRequest) => Promise<LinkFrame>;
	/** The permission hook the daemon decides for, held open until the decision lands. */
	postHook: (name: "cc-hook" | "cx-hook", body: Record<string, unknown>) => Promise<Response>;
	hookDecision: (response: Response) => Promise<unknown>;
	permissionReplies: () => RecordedCall[];
	stop: () => Promise<void>;
};

export async function startDecisionHarness(): Promise<DecisionHarness> {
	const env = setupTestEnv();
	const root = mkdtempSync(join(tmpdir(), "broski-link-decision-"));
	const socketPath = join(root, "run", "link.sock");

	const ocCalls: RecordedCall[] = [];
	const ocConnector = new OpenCodeConnector({ client: makeClient(ocCalls).client, baseUrl: "http://127.0.0.1:1" });

	const log = createLeveledLogger({});
	const state = createBridgeState({
		opencode: null,
		auth: { version: 1, token: "decision-test-token", createdAt: Date.now() },
		webDistDir: "/tmp",
		defaultAgent: "claude-code",
		limits: createLimits(),
		logInfo: () => {},
	});
	const streams = createStreams({ state, log, debugRts: false });
	const opencodeEvents = createOpenCodeEvents({
		state,
		streams,
		log,
		debugRts: false,
		requireOpenCode: () => {
			throw new Error("the decision tests never start an OpenCode server");
		},
		syncExternalTailForKey: () => {},
	});

	// The tracker is process-wide, so earlier files' sessions must not colour this file's assertions.
	resetLinkFeed();
	const bridge = await startBridge({ linkSocket: socketPath, opencode: ocConnector });

	const alertFor = async (feed: UnixWsClient, backend: string, session: string): Promise<LinkFrame> => {
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline) {
			const found = feed
				.frames()
				.find((frame) => frame.type === "link_event" && frame.backend === backend && frame.session === session);
			if (found) return found;
			await Bun.sleep(10);
		}
		throw new Error(`no ${backend} alert arrived for ${session}`);
	};

	return {
		socketPath,
		ccStream: (message, sessionId, cwd) => {
			if (cwd) state.ccSessionCwds.set(sessionId, cwd);
			streams.emitCcStream(sessionId, message);
		},
		cxStream: (message, threadId) => {
			streams.emitCxStream(threadId, message);
		},
		ocStream: (payloadType, properties) => {
			opencodeEvents.enqueueSdkEvent({ directory: CWD, payload: { type: payloadType, properties } });
		},
		durablePermission: (sessionId, requestId) => {
			const request: PiDurablePermissionRequest = {
				requestId,
				sessionId,
				toolName: "bash",
				input: { command: "echo hi" },
				title: "Run bash",
			};
			broadcastPiDurablePermission(request);
		},
		alertFor,
		decide: async (feed, input) => {
			feed.clear();
			feed.send({ type: "link_decision", ...input });
			return feed.waitForWhere(
				(frame) => frame.type === "link_decision_result" && frame.request === input.request,
				"link_decision_result",
			);
		},
		postHook: (name, body) =>
			fetch(`http://127.0.0.1:${bridge.port}/${name}`, {
				method: "POST",
				headers: { authorization: `Bearer ${bridge.token}`, "content-type": "application/json" },
				body: JSON.stringify(body),
			}),
		hookDecision: async (response) => {
			const body = (await response.json()) as { hookSpecificOutput?: { permissionDecision?: unknown } };
			return body.hookSpecificOutput?.permissionDecision;
		},
		permissionReplies: () => ocCalls.filter((call) => call.name === "permission.reply"),
		stop: async () => {
			await bridge.stop();
			env.restore();
			rmSync(root, { recursive: true, force: true });
		},
	};
}
