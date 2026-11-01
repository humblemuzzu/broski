/**
 * Stand-ins for the parts other lanes build (catalogue C, mapping B, asks E, store A), so lane D's hosts are tested
 * without reaching into their directories. Each does the least the host needs and nothing it does not.
 */

import type { CanUseTool, OnElicitation, SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
	AskDesk,
	AskDeskFactory,
	AskHost,
	CatalogueAccess,
	ClaudeSdk,
	FrameMapper,
	MappedEvent,
	MappingPort,
	Ownership,
	PromptRecord,
	SessionStore,
	StoredSession,
} from "../../../../backends/claude-code/ports";
import { notBuilt, rejected } from "../../../../backends/claude-code/rejections";
import type {
	ActionResult,
	ModeAxis,
	ModelId,
	ModelSummary,
	NewSessionResult,
	Rejected,
	RunOutcome,
	SessionGetResult,
	SessionId,
} from "../../../../contract";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

function model(id: string, isDefault: boolean): ModelSummary {
	return {
		id,
		displayName: id,
		thinking: { options: EFFORTS.map((value) => ({ value })) },
		isDefault,
	};
}

export const STAND_IN_MODELS: readonly ModelSummary[] = [
	model("default", true),
	model("opus", false),
	model("sonnet", false),
	model("haiku", false),
];

export const STAND_IN_AXIS: ModeAxis = {
	id: "permissions",
	label: "Permissions",
	options: ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"].map((value) => ({
		value,
		label: value,
	})),
	defaultValue: "default",
};

export interface StandInCatalogue extends CatalogueAccess {
	readonly observed: { cwd: string; version: string | undefined }[];
	readonly invalidated: (string | undefined)[];
}

/** Lists the four models and the six modes; a wire id resolves to the listed id `wires` names. */
export function standInCatalogue(wires: Readonly<Record<string, ModelId>> = {}): StandInCatalogue {
	const observed: StandInCatalogue["observed"] = [];
	const invalidated: (string | undefined)[] = [];
	return {
		observed,
		invalidated,
		initialize: async () => notBuilt("stand-in catalogue: initialize"),
		observe: (cwd, init) => {
			observed.push({ cwd, version: init.claude_code_version });
		},
		invalidate: (cwd) => {
			invalidated.push(cwd);
		},
		models: async () => ({ status: "accepted", models: [...STAND_IN_MODELS] }),
		commands: async () => ({ status: "accepted", commands: [] }),
		modes: async () => ({ status: "accepted", modes: [STAND_IN_AXIS] }),
		model: async (_cwd, id) => STAND_IN_MODELS.find((candidate) => candidate.id === id),
		listedModelId: async (_cwd, wire) => wires[wire],
		status: async () => ({ installed: true, auth: "unknown", usable: true, issues: [] }),
	};
}

export function outcomeOf(result: SDKResultMessage): RunOutcome {
	if (result.terminal_reason === "aborted_streaming" || result.terminal_reason === "aborted_tools") {
		return { kind: "aborted" };
	}
	if (result.is_error) return { kind: "error", error: { code: "unknown", message: "the turn failed" } };
	return { kind: "completed" };
}

export interface StandInMapping extends MappingPort {
	readonly mapped: SDKMessage[];
	readonly noted: string[];
	readonly settled: ("completed" | "aborted")[];
	/** The session id each mapper was created for, in order. */
	readonly seeds: string[];
	/** True: `settle` throws, as a broken part of another lane would. */
	failSettle: boolean;
	/** Events `map` returns for each frame, to drive the host's routing. */
	script(events: (frame: SDKMessage) => readonly MappedEvent[]): void;
	/** Resolves once a frame of `type` has been mapped (now, if one has). */
	waitForFrame(type: SDKMessage["type"], timeoutMs?: number): Promise<void>;
}

/** A mapper that shows nothing unless a test scripts it: the host owns every event these tests check. */
export function standInMapping(): StandInMapping {
	const mapped: SDKMessage[] = [];
	const noted: string[] = [];
	const settled: ("completed" | "aborted")[] = [];
	const seeds: string[] = [];
	let scripted: (frame: SDKMessage) => readonly MappedEvent[] = () => [];
	const listeners = new Set<() => void>();
	const mapper: FrameMapper = {
		map: (frame) => {
			mapped.push(frame);
			for (const listener of [...listeners]) listener();
			return scripted(frame);
		},
		noteSend: (uuid) => {
			noted.push(uuid);
		},
		settle: (outcome) => {
			settled.push(outcome);
			if (state.failSettle) throw new Error("the mapper is broken");
			return [];
		},
	};
	const state = { failSettle: false };
	return {
		get failSettle() {
			return state.failSettle;
		},
		set failSettle(value: boolean) {
			state.failSettle = value;
		},
		mapped,
		noted,
		settled,
		seeds,
		script: (events) => {
			scripted = events;
		},
		waitForFrame: (type, timeoutMs = 15_000) =>
			new Promise<void>((resolve, reject) => {
				const check = () => {
					if (!mapped.some((frame) => frame.type === type)) return;
					clearTimeout(timer);
					listeners.delete(check);
					resolve();
				};
				const timer = setTimeout(() => {
					listeners.delete(check);
					reject(new Error(`no ${type} frame within ${timeoutMs} ms`));
				}, timeoutMs);
				listeners.add(check);
				check();
			}),
		createMapper: (seed) => {
			seeds.push(seed.sessionId);
			return mapper;
		},
		turnOutcome: outcomeOf,
	};
}

export interface StandInDesk {
	readonly factory: AskDeskFactory;
	readonly hosts: AskHost[];
	readonly withdrawn: string[];
	readonly elicitationsCompleted: string[];
	expired: number;
}

/** A desk that waits for the CLI to withdraw every ask, as the stub does: it never answers for anyone. */
export function standInDesk(): StandInDesk {
	const state: StandInDesk = {
		hosts: [],
		withdrawn: [],
		elicitationsCompleted: [],
		expired: 0,
		factory: (host: AskHost): AskDesk => {
			state.hosts.push(host);
			const canUseTool: CanUseTool = (_tool, _input, options) =>
				new Promise((resolve) => {
					options.signal.addEventListener("abort", () => resolve({ behavior: "deny", message: "withdrawn" }), {
						once: true,
					});
				});
			const onElicitation: OnElicitation = (_request, options) =>
				new Promise((resolve) => {
					options.signal.addEventListener("abort", () => resolve({ action: "cancel" }), { once: true });
				});
			return {
				canUseTool,
				onElicitation,
				answer: () => notBuilt("stand-in desk: answer"),
				elicitationComplete: (id) => {
					state.elicitationsCompleted.push(id);
				},
				withdrawRun: (runId) => {
					state.withdrawn.push(runId);
				},
				expireAll: () => {
					state.expired += 1;
				},
			};
		},
	};
	return state;
}

export interface StandInOwnership extends Ownership {
	readonly claimed: string[];
	readonly prompts: { sessionId: string; uuid: string; record: PromptRecord }[];
}

export function standInOwnership(): StandInOwnership {
	const claimed: string[] = [];
	const prompts: StandInOwnership["prompts"] = [];
	return {
		claimed,
		prompts,
		load: async () => undefined,
		origin: (sessionId) => (claimed.includes(sessionId) ? "broski" : "external"),
		claim: async (sessionId) => {
			claimed.push(sessionId);
		},
		notePrompt: async (sessionId, uuid, record) => {
			prompts.push({ sessionId, uuid, record });
		},
		prompt: (sessionId, uuid) => prompts.find((p) => p.sessionId === sessionId && p.uuid === uuid)?.record,
	};
}

export interface StandInStore extends SessionStore {
	readonly invalidated: SessionId[];
	readonly announced: SessionId[];
	/** Sessions the stand-in knows, for `locate`; real runs add theirs through the SDK. */
	readonly known: Map<SessionId, { cwd: string; modelId?: string }>;
	/** The overlay row at each `announce`, to see what the catalogue would have read. */
	readonly rows: { sessionId: SessionId; status: string | undefined; cut: string | null | undefined }[];
}

/** `locate` and `lastChainUuid` read the real session files through the SDK port; everything else is not built. */
export function standInStore(sdk: ClaudeSdk): StandInStore {
	const known = new Map<SessionId, { cwd: string; modelId?: string }>();
	const invalidated: SessionId[] = [];
	const announced: SessionId[] = [];
	const rows: StandInStore["rows"] = [];
	const no = (what: string): Rejected => notBuilt(`stand-in store: ${what}`);
	const locate = async (sessionId: SessionId): Promise<StoredSession | Rejected> => {
		const info = await sdk.getSessionInfo(sessionId, known.get(sessionId) && { dir: known.get(sessionId)?.cwd });
		if (!info) return rejected("not_found", `no session ${sessionId}`);
		return {
			sessionId,
			cwd: info.cwd,
			path: "",
			origin: "broski",
			lastModified: info.lastModified,
		};
	};
	return {
		invalidated,
		announced,
		known,
		rows,
		list: async () => no("list"),
		get: async (sessionId): Promise<SessionGetResult> =>
			known.has(sessionId.split("/")[0] ?? "")
				? {
						status: "accepted",
						summary: {
							session: { backend: "claude-code", sessionId },
							updatedAt: 1,
							archived: false,
							status: "idle",
							origin: "broski",
							...(known.get(sessionId)?.modelId !== undefined && { modelId: known.get(sessionId)?.modelId }),
						},
					}
				: rejected("not_found", `no session ${sessionId}`),
		transcript: async () => no("transcript"),
		attachment: async () => no("attachment"),
		locate,
		lastChainUuid: async (sessionId) => {
			const dir = known.get(sessionId)?.cwd;
			const chain = await sdk.getSessionMessages(sessionId, dir === undefined ? undefined : { dir });
			return chain.at(-1)?.uuid ?? null;
		},
		entryOf: async () => no("entryOf"),
		rename: async (): Promise<ActionResult> => no("rename"),
		fork: async (): Promise<NewSessionResult> => no("fork"),
		remove: async (): Promise<ActionResult> => no("remove"),
		announce: async (sessionId, live) => {
			announced.push(sessionId);
			const row = live.row(sessionId);
			rows.push({ sessionId, status: row?.status, cut: row?.cut?.lastUuidBefore });
		},
		invalidate: (sessionId) => {
			invalidated.push(sessionId);
		},
		dispose: () => undefined,
	};
}
