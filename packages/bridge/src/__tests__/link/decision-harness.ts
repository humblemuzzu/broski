/**
 * Shared plumbing for the daemon-decision tests: one real bridge on a link socket, the per-backend
 * entry points the feed taps, and the waits a decision's assertions use.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLimits } from "../../server/limits";
import { resetLinkFeed } from "../../server/link-feed/feed";
import { createLeveledLogger } from "../../server/logger";
import { createBridgeState } from "../../server/state";
import { createStreams } from "../../server/streams";
import type { ClaudeCodeStreamMessage } from "../../types/claude-code-stream-message";
import type { BroskiUserInputRequest } from "../../types/runtime";
import { setupTestEnv, startBridge } from "../e2e/harness";
import type { LinkFrame, UnixWsClient } from "./unix-ws";

export type DecisionRequest = { backend: string; session: string; request: string; decision: "allow" | "deny" };

export type DecisionHarness = {
	socketPath: string;
	ccStream: (message: ClaudeCodeStreamMessage, sessionId: string, cwd?: string) => void;
	/** A request for input; the Claude Code stream itself never produces one. */
	inputRequest: (sessionId: string, request: BroskiUserInputRequest) => void;
	alertFor: (feed: UnixWsClient, backend: string, session: string) => Promise<LinkFrame>;
	/** Sends one decision and returns its result; earlier frames are dropped so a repeat cannot match. */
	decide: (feed: UnixWsClient, input: DecisionRequest) => Promise<LinkFrame>;
	/** The permission hook the daemon decides for, held open until the decision lands. */
	postHook: (name: "cc-hook", body: Record<string, unknown>) => Promise<Response>;
	hookDecision: (response: Response) => Promise<unknown>;
	stop: () => Promise<void>;
};

export async function startDecisionHarness(): Promise<DecisionHarness> {
	const env = setupTestEnv();
	const root = mkdtempSync(join(tmpdir(), "broski-link-decision-"));
	const socketPath = join(root, "run", "link.sock");

	const log = createLeveledLogger({});
	const state = createBridgeState({
		auth: { version: 1, token: "decision-test-token", createdAt: Date.now() },
		defaultAgent: "claude-code",
		limits: createLimits(),
		logInfo: () => {},
	});
	const streams = createStreams({ state, log, debugRts: false });

	// The tracker is process-wide, so earlier files' sessions must not colour this file's assertions.
	resetLinkFeed();
	const bridge = await startBridge({ linkSocket: socketPath });

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
		inputRequest: (sessionId, request) => {
			streams.broadcast({
				type: "runtime_event",
				backend: "claude-code",
				data: { type: "user_input_requested", backend: "claude-code", timestampMs: Date.now(), sessionId, request },
			});
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
		stop: async () => {
			await bridge.stop();
			env.restore();
			rmSync(root, { recursive: true, force: true });
		},
	};
}
