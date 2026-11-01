/** The rows of `settings_overview`: problems, the account, permission rules by source, and the settings in effect. */

import type { AccountInfo, ProvenanceEntry, ResolvedSettings, Settings } from "@anthropic-ai/claude-agent-sdk";
import { isRecord } from "../json";
import type { RowSpec } from "./list-rows";
import { previewOf } from "./settings-preview";

const MAX_RULE_ROWS = 400;

export function sourceLabel(entry: ProvenanceEntry | undefined): string {
	if (entry === undefined) return "default";
	return entry.source === "managed" && entry.policyOrigin !== undefined
		? `managed (${entry.policyOrigin})`
		: entry.source;
}

export function problemRows(problems: readonly { readonly title: string; readonly message: string }[]): RowSpec[] {
	return problems.map((problem, index) => ({
		id: `problem:${index}`,
		title: problem.title,
		subtitle: problem.message,
		status: { label: "problem", tone: "error" as const },
		group: "Problems",
	}));
}

const ACCOUNT_FIELDS: readonly (readonly [keyof AccountInfo, string])[] = [
	["email", "Email"],
	["organization", "Organization"],
	["subscriptionType", "Plan"],
	["apiProvider", "Provider"],
	["tokenSource", "Sign-in"],
	["apiKeySource", "API key from"],
];

export function accountRows(account: AccountInfo): RowSpec[] {
	const rows: RowSpec[] = [];
	for (const [field, title] of ACCOUNT_FIELDS) {
		const value = account[field];
		if (typeof value === "string" && value !== "")
			rows.push({ id: `account:${field}`, title, subtitle: value, group: "Account" });
	}
	return rows;
}

function ruleRows(resolved: ResolvedSettings): RowSpec[] {
	const rows: RowSpec[] = [];
	const behaviours = [
		["deny", "error"],
		["ask", "warning"],
		["allow", "ok"],
	] as const;
	for (const source of [...resolved.sources].reverse()) {
		const permissions = source.settings.permissions;
		if (!isRecord(permissions)) continue;
		for (const [behaviour, tone] of behaviours) {
			const rules = permissions[behaviour];
			if (!Array.isArray(rules)) continue;
			rules.forEach((rule, index) => {
				if (typeof rule !== "string") return;
				const origin = source.source === "managed" ? `managed (${source.policyOrigin ?? "policy"})` : source.source;
				rows.push({
					id: `rule:${source.source}:${behaviour}:${index}`,
					title: rule,
					status: { label: behaviour, tone },
					group: "Permissions",
					badges: [origin],
				});
			});
		}
	}
	return rows.slice(0, MAX_RULE_ROWS);
}

export function permissionRows(resolved: ResolvedSettings, effective: Settings): RowSpec[] {
	const mode = effective.permissions?.defaultMode;
	const rows: RowSpec[] = [];
	if (mode !== undefined) {
		const origin = sourceLabel(resolved.provenance.permissions);
		rows.push({
			id: "mode:default",
			title: "Default permission mode",
			subtitle: mode,
			group: "Permissions",
			badges: [origin],
		});
	}
	return [...rows, ...ruleRows(resolved)];
}

export function settingRows(resolved: ResolvedSettings, effective: Settings): RowSpec[] {
	const rows: RowSpec[] = [];
	for (const key of Object.keys(effective).sort()) {
		if (key === "permissions") continue;
		const entry = resolved.provenance[key];
		const managed = entry?.source === "managed";
		rows.push({
			id: `setting:${key}`,
			title: key,
			subtitle: previewOf(key, effective[key]),
			...(managed && { status: { label: "managed by policy", tone: "warning" as const } }),
			group: "Settings",
			badges: [sourceLabel(entry)],
		});
	}
	return rows;
}
