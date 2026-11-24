/**
 * `ModelInfo` rows (the CLI's built-in list, not fetched) as contract models, in the order the phone shows them (D12).
 */

import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { MAX_CATALOG_ITEMS, MAX_TEXT_CHARS, type ModelId, type ModelSummary } from "../../../contract";
import { boundList, clip, fitsId, nameOr } from "../bounds";
import { thinkingSpec } from "./thinking";

/** The row `Query.setModel(undefined)` and a fresh session follow: the CLI names it `default`. */
const DEFAULT_ROW = "default";

function wireOf(row: ModelInfo): string {
	return row.resolvedModel ?? row.value;
}

/**
 * Rows the phone may choose, once each, in the CLI's own order ("Default (recommended)" first). A row that runs the
 * Default row's model (`opus` resolves to `claude-opus-5-5` as `default` does) is left out, so the phone never shows
 * one model twice and a request's wire model names its row (D12, conformance rule 19).
 */
export function listedRows(models: readonly ModelInfo[]): ModelInfo[] {
	const rows: ModelInfo[] = [];
	const seen = new Set<string>();
	for (const row of models) {
		if (!fitsId(row.value) || seen.has(row.value)) continue;
		seen.add(row.value);
		rows.push(row);
	}
	const defaultRow = rows.find((row) => row.value === DEFAULT_ROW);
	if (defaultRow === undefined) return rows;
	return rows.filter((row) => row === defaultRow || wireOf(row) !== wireOf(defaultRow));
}

function modelSummary(row: ModelInfo): ModelSummary {
	const description = clip(row.description, MAX_TEXT_CHARS);
	return {
		id: row.value,
		displayName: nameOr(row.displayName, row.value),
		...(description !== "" && { description }),
		thinking: thinkingSpec(row),
		isDefault: row.value === DEFAULT_ROW,
	};
}

export function modelSummaries(models: readonly ModelInfo[]): ModelSummary[] {
	return boundList(listedRows(models).map(modelSummary), MAX_CATALOG_ITEMS).items;
}

function canonicalWire(wireModel: string): string {
	return wireModel.replace(/\[[^\]]+\]$/u, "").replace(/-\d{8}$/u, "");
}

/** The listed id a wire model runs as; a wire id several rows share goes to the first of them in listed order. */
export function listedModelIdOf(models: readonly ModelInfo[], wireModel: string): ModelId | undefined {
	const rows = listedRows(models);
	const exact = rows.find((row) => row.value === wireModel) ?? rows.find((row) => row.resolvedModel === wireModel);
	if (exact !== undefined) return exact.value;
	const normalized = canonicalWire(wireModel);
	return rows.find((row) => row.resolvedModel !== undefined && canonicalWire(row.resolvedModel) === normalized)?.value;
}
