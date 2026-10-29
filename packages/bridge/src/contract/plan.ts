import { z } from "zod";
import { MAX_LIST_ITEMS, MAX_TEXT_CHARS } from "./limits";

export const PlanItemStatus = z.enum(["pending", "in_progress", "completed", "cancelled"]);
export type PlanItemStatus = z.infer<typeof PlanItemStatus>;

export const PlanItem = z.strictObject({ text: z.string().max(MAX_TEXT_CHARS), status: PlanItemStatus });
export type PlanItem = z.infer<typeof PlanItem>;

/** The agent's todo list, replaced whole on every change. A proposed plan is a `plan` block instead. */
export const Plan = z.strictObject({
	items: z.array(PlanItem).max(MAX_LIST_ITEMS),
	explanation: z.string().max(MAX_TEXT_CHARS).optional(),
});
export type Plan = z.infer<typeof Plan>;
