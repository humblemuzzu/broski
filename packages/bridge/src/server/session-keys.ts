import type { AgentType } from "../types";

export function makeSessionKey(agent: AgentType | undefined, sessionId: string | undefined): string | null {
	if (!agent || !sessionId) return null;
	return `${agent}:${sessionId}`;
}

export function parseSessionKey(key: string): { agent: AgentType; id: string } | null {
	const idx = key.indexOf(":");
	if (idx <= 0) return null;
	const agent = key.slice(0, idx) as AgentType;
	const id = key.slice(idx + 1);
	if (!id) return null;
	return { agent, id };
}
