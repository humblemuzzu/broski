import { z } from "zod";

export const NoticeLevel = z.enum(["info", "warning", "error"]);
export type NoticeLevel = z.infer<typeof NoticeLevel>;
