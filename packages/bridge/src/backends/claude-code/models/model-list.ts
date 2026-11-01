/** `ModelInfo` rows (the CLI's built-in list, 08-spike Q11) as contract models, in the order the phone shows them (D60). */

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
 * Rows the phone may choose, once each. A row whose wire id no other row shares comes before the aliases that share
 * one (`default` and `opus` both resolve to `claude-opus-5-5`), so a request's wire model names its row, which the
 * conformance suite's `echo_model` reads off the first two listed models (STEP-3 §11). The CLI's order is kept inside
 * both groups.
 */
export function listedRows(models: readonly ModelInfo[]): ModelInfo[] {
	const rows: ModelInfo[] = [];
	const seen = new Set<string>();
	for (const row of models) {
		if (!fitsId(row.value) || seen.has(row.value)) continue;
		seen.add(row.value);
		rows.push(row);
	}
	const sharing = new Map<string, number>();
	for (const row of rows) sharing.set(wireOf(row), (sharing.get(wireOf(row)) ?? 0) + 1);
	const own = rows.filter((row) => sharing.get(wireOf(row)) === 1);
	return [...own, ...rows.filter((row) => sharing.get(wireOf(row)) !== 1)];
}

export function modelSummary(row: ModelInfo): ModelSummary {
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

/** The listed id a wire model runs as; a wire id several rows share goes to the first of them in listed order. */
export function listedModelIdOf(models: readonly ModelInfo[], wireModel: string): ModelId | undefined {
	const rows = listedRows(models);
	return (rows.find((row) => row.value === wireModel) ?? rows.find((row) => row.resolvedModel === wireModel))?.value;
}
