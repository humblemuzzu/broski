/** A hosted session with two exchanges, and `navigate_tree` wired to it the way `backend.ts` wires it. */

import { readFileSync } from "node:fs";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { type InlineExtension, SessionManager } from "@earendil-works/pi-coding-agent";
import { CatalogFeed } from "../../backends/pi/catalog-feed";
import { entryItemId, parseEntryPart } from "../../backends/pi/ids";
import { navigateTree } from "../../backends/pi/ops/navigate-tree";
import type { HostAccess } from "../../backends/pi/ports";
import { rejected } from "../../backends/pi/rejections";
import type { BackendCallResult, CatalogEvent } from "../../contract";
import { createRig, type Rig } from "./ui_rig";

export interface Scene {
	readonly r: Rig;
	readonly events: CatalogEvent[];
	readonly file: string;
	/** Entry ids by role: the two user messages and the two replies, oldest first. */
	readonly users: string[];
	readonly replies: string[];
	navigate(entryId: string, summarize: boolean): Promise<BackendCallResult>;
}

export async function makeScene(onRig: (rig: Rig) => void, extensions: InlineExtension[] = []): Promise<Scene> {
	const r = await createRig({ extensions });
	onRig(r);
	await r.bind();
	r.faux.handle.setResponses([fauxAssistantMessage("first reply"), fauxAssistantMessage("second reply")]);
	await r.session.prompt("one", { expandPromptTemplates: false });
	await r.session.prompt("two", { expandPromptTemplates: false });
	const file = r.session.sessionFile ?? "";
	const messages = r.session.sessionManager.getEntries().filter((entry) => entry.type === "message");
	const ofRole = (role: string) => messages.filter((entry) => entry.message.role === role).map((entry) => entry.id);
	const events: CatalogEvent[] = [];
	const catalog = new CatalogFeed({ emit: (event) => events.push(event) });
	const hosts: HostAccess = {
		withIdleSession: async (sessionId, work) =>
			sessionId === r.session.sessionId ? work(r.session) : rejected("unsupported", "another client's session"),
	};
	const store = {
		entryOf: async (_sessionId: string, itemId: string) => {
			return parseEntryPart(itemId)?.entryId;
		},
	};
	const live = { row: () => undefined };
	return {
		r,
		events,
		file,
		users: ofRole("user"),
		replies: ofRole("assistant"),
		navigate: (entryId, summarize) =>
			navigateTree(
				{ hosts, store, live, catalog },
				{ kind: "navigate_tree", sessionId: r.session.sessionId, itemId: entryItemId(entryId, 0), summarize },
			),
	};
}

export function fileEntries(
	file: string,
): { id: string; parentId: string | null; type: string; [key: string]: unknown }[] {
	return readFileSync(file, "utf8")
		.trimEnd()
		.split("\n")
		.slice(1)
		.map((line) => JSON.parse(line));
}

export function reopened(file: string, r: Rig): SessionManager {
	return SessionManager.open(file, r.env.sessionDir);
}
