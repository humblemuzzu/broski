import { basename } from "node:path";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { Cursor } from "@earendil-works/pi-durable";
import type { PiDurableModelChoice, PiDurableSessionMeta } from "../../connectors/pi-durable";
import type { PiDurableModelRef } from "../../types/pi-durable";
import type { BroskiModelSummary, BroskiSessionSummary } from "../../types/runtime";
import { sessionPreview } from "../../utils/session-preview";

const THINKING_LEVELS: readonly ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export type PiDurableProjectSummary = {
	id: string;
	name: string;
	path: string;
};

export function parsePiDurableThinkingLevel(value: unknown): ModelThinkingLevel | undefined {
	return THINKING_LEVELS.find((level) => level === value);
}

/** Accepts explicit `provider`/`modelId` fields, a `{provider, modelId}` object, or the `provider/modelId` label. */
export function parsePiDurableModelRef(source: {
	provider?: unknown;
	modelId?: unknown;
	model?: unknown;
}): PiDurableModelRef | undefined {
	const explicit = modelRefOf(source);
	if (explicit !== undefined) return explicit;

	const nested = asRecord(source.model);
	if (nested !== undefined) return modelRefOf(nested);

	const combined = typeof source.model === "string" ? source.model.trim() : "";
	const separator = combined.indexOf("/");
	if (separator <= 0 || separator === combined.length - 1) return undefined;
	return { provider: combined.slice(0, separator), modelId: combined.slice(separator + 1) };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	return Object.fromEntries(Object.entries(value));
}

function modelRefOf(source: { provider?: unknown; modelId?: unknown }): PiDurableModelRef | undefined {
	const provider = typeof source.provider === "string" ? source.provider.trim() : "";
	const modelId = typeof source.modelId === "string" ? source.modelId.trim() : "";
	return provider !== "" && modelId !== "" ? { provider, modelId } : undefined;
}

export function isPiDurableCursor(value: unknown): value is Cursor {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function piDurableModelSummaryOf(choice: PiDurableModelChoice): BroskiModelSummary {
	const backendData =
		choice.selectedOrder === undefined && choice.isDefault !== true
			? undefined
			: {
					...(choice.selectedOrder !== undefined ? { selectedOrder: choice.selectedOrder } : {}),
					...(choice.isDefault === true ? { isDefault: true } : {}),
				};
	return {
		id: choice.modelId,
		backend: "pi-durable",
		label: `${choice.provider}/${choice.modelId}`,
		providerId: choice.provider,
		contextWindow: choice.contextWindow,
		supportsReasoning: choice.supportsReasoning,
		supportsTools: true,
		...(backendData !== undefined ? { backendData } : {}),
	};
}

export function piDurableSessionSummaryOf(meta: PiDurableSessionMeta, isOpen: boolean): BroskiSessionSummary {
	return {
		id: meta.id,
		backend: "pi-durable",
		title: sessionPreview(meta.title?.trim() || basename(meta.cwd) || meta.id),
		cwd: meta.cwd,
		createdAtMs: meta.createdAtMs,
		updatedAtMs: meta.updatedAtMs,
		...(isOpen ? { isActive: true } : {}),
		...(meta.model !== undefined ? { modelLabel: `${meta.model.provider}/${meta.model.modelId}` } : {}),
		sessionKind: "root",
		backendData: {
			...(meta.model !== undefined ? { model: meta.model } : {}),
			...(meta.thinkingLevel !== undefined ? { thinkingLevel: meta.thinkingLevel } : {}),
		},
	};
}

export function piDurableProjectSummariesOf(metas: readonly PiDurableSessionMeta[]): PiDurableProjectSummary[] {
	const projects = new Map<string, PiDurableProjectSummary>();
	for (const meta of metas) {
		const cwd = meta.cwd.trim();
		if (cwd === "" || projects.has(cwd)) continue;
		projects.set(cwd, { id: cwd, name: basename(cwd), path: cwd });
	}
	return [...projects.values()];
}
