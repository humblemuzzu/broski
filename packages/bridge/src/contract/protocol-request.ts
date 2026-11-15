import { z } from "zod";

/** Chosen by the client; the response carries it back. */
export const RequestId = z.string().min(1).max(128);
export type RequestId = z.infer<typeof RequestId>;

export function request<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
	return z.strictObject({ type: z.literal(type), requestId: RequestId, ...shape });
}

export function response<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
	return z.strictObject({ type: z.literal(`${type}.result`), requestId: RequestId, ...shape });
}
