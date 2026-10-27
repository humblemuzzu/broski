import { MODULE_TYPES as OC_MODULE_TYPES } from "../handlers/oc_routing";
import { OPENCODE_READY_TIMEOUT_MS, type OpenCodeSlot } from "./opencode-slot";

/** Every message type whose handler cannot answer without OpenCode. */
const NEEDS_OPENCODE: ReadonlySet<string> = new Set<string>(OC_MODULE_TYPES);

export function needsOpenCode(type: string): boolean {
	return NEEDS_OPENCODE.has(type);
}

/**
 * Waits, up to [timeoutMs], for a managed OpenCode start to land.
 *
 * A bridge that is up answers immediately; the ten seconds a managed start takes belong to the
 * requests that actually need it, and they get the reason when it never arrives.
 */
export async function awaitOpenCode(
	slot: OpenCodeSlot,
	timeoutMs = OPENCODE_READY_TIMEOUT_MS,
): Promise<{ ok: true } | { ok: false; error: string }> {
	if (slot.current()) return { ok: true };
	if (!slot.pending()) return { ok: false, error: unavailableMessage(slot) };
	const connector = await slot.ready(timeoutMs);
	return connector ? { ok: true } : { ok: false, error: unavailableMessage(slot) };
}

function unavailableMessage(slot: OpenCodeSlot): string {
	return `OpenCode unavailable: ${slot.reason() ?? "it is not installed"}`;
}
