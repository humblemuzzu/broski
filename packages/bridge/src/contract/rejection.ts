import { z } from "zod";
import { MAX_TEXT_CHARS } from "./limits";

export const RejectionCode = z.enum([
	"busy",
	"not_steerable",
	"no_model",
	"auth",
	"invalid_input",
	"unsupported",
	"not_found",
	"forbidden",
	"stale",
	"closed",
	"backend_error",
]);
export type RejectionCode = z.infer<typeof RejectionCode>;

export const Rejection = z.strictObject({ code: RejectionCode, message: z.string().max(MAX_TEXT_CHARS) });
export type Rejection = z.infer<typeof Rejection>;

/** The refusal every result union shares: nothing happened, for the reason `rejection` gives. */
export const Rejected = z.strictObject({ status: z.literal("rejected"), rejection: Rejection });
export type Rejected = z.infer<typeof Rejected>;
