import type { ErrorResponse, ProtocolErrorCode, Rejected, RejectionCode } from "../contract";

export const HELLO_FIRST = "send hello first: no protocol version is agreed yet";

export function rejected(code: RejectionCode, message: string): Rejected {
	return { status: "rejected", rejection: { code, message } };
}

export function protocolError(requestId: string | undefined, code: ProtocolErrorCode, message: string): ErrorResponse {
	return { type: "error", ...(requestId !== undefined && { requestId }), error: { code, message } };
}

export function unsupported(what: string): Rejected {
	return rejected("unsupported", `this backend cannot ${what}`);
}
