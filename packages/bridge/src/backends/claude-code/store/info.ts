/** Lane A · one session's `SDKSessionInfo`, and where its file is (`StoredSession`). */

import type { SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import type { Rejected, SessionId } from "../../../contract";
import type { StoreDeps } from "../ports/deps";
import type { StoredSession } from "../ports/store";
import { notBuilt } from "../rejections";

export async function sessionInfo(_deps: StoreDeps, _sessionId: SessionId): Promise<SDKSessionInfo | undefined> {
	return undefined;
}

export async function locateSession(_deps: StoreDeps, _sessionId: SessionId): Promise<StoredSession | Rejected> {
	return notBuilt("lane A: locateSession");
}
