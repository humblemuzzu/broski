/**
 * Protocol compatibility retry utility for Codex RPC calls.
 *
 * Some Codex versions don't support newer optional params (serviceTier,
 * sandboxPolicy). This module wraps RPC calls with automatic retry logic
 * that strips unsupported params on protocol errors.
 */

import type { CodexAppServerClient } from "../connectors/codex";

// Track which optional params are unsupported by this Codex version
const unsupportedParams = new Set<string>();

/**
 * Send a Codex RPC request, retrying once without optional params if the
 * server rejects them with -32600 (Invalid Request) or -32602 (Invalid params).
 */
export async function codexRequestWithRetry(
	client: CodexAppServerClient,
	method: string,
	params: Record<string, unknown>,
	optionalParams: string[] = ["serviceTier", "sandboxPolicy"],
): Promise<unknown> {
	// Strip known-unsupported params before first attempt
	const cleanParams = { ...params };
	for (const key of unsupportedParams) {
		delete cleanParams[key];
	}

	try {
		return await client.request(method, cleanParams);
	} catch (err: any) {
		const code = err?.code ?? err?.data?.code;
		// -32600 = Invalid Request, -32602 = Invalid params
		if (code === -32600 || code === -32602) {
			// Retry without optional params
			const retryParams = { ...cleanParams };
			let stripped = false;
			for (const key of optionalParams) {
				if (key in retryParams) {
					unsupportedParams.add(key);
					delete retryParams[key];
					stripped = true;
				}
			}
			// If we actually removed something, retry
			if (stripped) {
				return await client.request(method, retryParams);
			}
		}
		throw err;
	}
}

/**
 * Interrupt a running turn with fallback for method/param naming variations
 * across Codex versions. Tries turn/interrupt, then turn/cancel, with both
 * camelCase and snake_case param styles.
 */
export async function codexInterruptWithRetry(
	client: CodexAppServerClient,
	threadId: string,
	turnId?: string,
): Promise<unknown> {
	const methods = ["turn/interrupt", "turn/cancel"];
	const paramVariants = [
		{ threadId, ...(turnId ? { turnId } : {}) },
		{ thread_id: threadId, ...(turnId ? { turn_id: turnId } : {}) },
	];

	for (const method of methods) {
		for (const params of paramVariants) {
			try {
				return await client.request(method, params);
			} catch (err: any) {
				const code = err?.code ?? err?.data?.code;
				// -32601 = Method not found, -32600 = Invalid Request, -32602 = Invalid params
				if (code === -32601 || code === -32600 || code === -32602) {
					continue; // Try next variant
				}
				throw err;
			}
		}
	}
	throw new Error("All interrupt variants failed");
}

/** Reset tracked unsupported params (e.g. after Codex process restart). */
export function resetUnsupportedParams(): void {
	unsupportedParams.clear();
}
