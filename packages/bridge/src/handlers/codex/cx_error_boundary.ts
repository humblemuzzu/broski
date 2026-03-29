/**
 * Wraps a Codex handler function with standardized error boundary.
 * Catches errors, formats them consistently, and replies with `cx_error` type.
 */
export async function withCxErrorBoundary<T>(
	handlerName: string,
	reply: (msg: any) => void,
	requestId: string | undefined,
	fn: () => Promise<T>,
): Promise<T | null> {
	try {
		return await fn();
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		const code = extractErrorCode(error);

		console.error(`[Codex:${handlerName}] Error:`, message);

		reply({
			type: "cx_error",
			error: message,
			code,
			handler: handlerName,
			...(requestId ? { requestId } : {}),
		});

		return null;
	}
}

function extractErrorCode(error: unknown): string {
	if (error instanceof Error) {
		// JSON-RPC errors from Codex app-server
		const anyError = error as any;
		if (anyError.code) return String(anyError.code);
		if (anyError.data?.code) return String(anyError.data.code);

		// Network/timeout errors
		if (error.message.includes("ECONNREFUSED")) return "connection_refused";
		if (error.message.includes("timeout")) return "timeout";
		if (error.message.includes("ENOENT")) return "not_found";
	}
	return "unknown";
}
