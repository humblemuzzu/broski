import type { Rejected, RejectionCode } from "../contract";

export function rejected(code: RejectionCode, message: string): Rejected {
	return { status: "rejected", rejection: { code, message } };
}

export const ACCEPTED = { status: "accepted" } as const;
