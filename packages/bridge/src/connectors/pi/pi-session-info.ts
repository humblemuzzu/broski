import type { Model } from "@earendil-works/pi-ai/compat";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { PiForkMessagePayload, PiModelPayload, PiSessionInfo } from "../../types";
import { sessionPreview } from "../../utils/session-preview";
import type { PiInstance } from "./pi-instance-types";
import { mapPiModel } from "./pi-model-runtime";
import { enrichPiSessionsWithStats } from "./pi-session-enrich";

export function mapSessionInfo(session: SessionInfo): PiSessionInfo {
	return {
		path: session.path,
		id: session.id,
		cwd: session.cwd,
		name: session.name,
		parentSessionPath: session.parentSessionPath,
		created: session.created.getTime(),
		modified: session.modified.getTime(),
		messageCount: session.messageCount,
		firstMessage: sessionPreview(session.firstMessage),
		// summary is populated asynchronously by enrichSessionsWithStats()
	};
}

export async function enrichSessionsWithStats(sessions: PiSessionInfo[]): Promise<void> {
	return enrichPiSessionsWithStats(sessions);
}

export function mapModel(model: Model<any>): PiModelPayload {
	return mapPiModel(model);
}

export function mapForkMessages(instance: PiInstance): PiForkMessagePayload[] {
	return instance.session.getUserMessagesForForking().map((message) => ({
		entryId: message.entryId,
		text: message.text,
	}));
}
