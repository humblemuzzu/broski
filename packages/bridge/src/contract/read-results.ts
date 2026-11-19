import { z } from "zod";
import { CommandSummary } from "./commands";
import { ImageContent } from "./content";
import { MAX_CATALOG_ITEMS, MAX_LIST_ITEMS } from "./limits";
import { ModelSummary } from "./models";
import { ModeAxis } from "./modes";
import { Rejected } from "./rejection";
import { SessionPage, SessionSummary } from "./sessions";
import { TranscriptPage } from "./transcript";

export const ModelsListed = z.strictObject({
	status: z.literal("accepted"),
	models: z.array(ModelSummary).max(MAX_CATALOG_ITEMS),
});
export type ModelsListed = z.infer<typeof ModelsListed>;

export const ModelsListResult = z.discriminatedUnion("status", [ModelsListed, Rejected]);
export type ModelsListResult = z.infer<typeof ModelsListResult>;

export const CommandsListed = z.strictObject({
	status: z.literal("accepted"),
	commands: z.array(CommandSummary).max(MAX_CATALOG_ITEMS),
});
export type CommandsListed = z.infer<typeof CommandsListed>;

export const CommandsListResult = z.discriminatedUnion("status", [CommandsListed, Rejected]);
export type CommandsListResult = z.infer<typeof CommandsListResult>;

export const ModesListed = z.strictObject({
	status: z.literal("accepted"),
	modes: z.array(ModeAxis).max(MAX_LIST_ITEMS),
});
export type ModesListed = z.infer<typeof ModesListed>;

export const ModesListResult = z.discriminatedUnion("status", [ModesListed, Rejected]);
export type ModesListResult = z.infer<typeof ModesListResult>;

export const SessionsListed = z.strictObject({ status: z.literal("accepted"), page: SessionPage });
export type SessionsListed = z.infer<typeof SessionsListed>;

export const SessionsListResult = z.discriminatedUnion("status", [SessionsListed, Rejected]);
export type SessionsListResult = z.infer<typeof SessionsListResult>;

export const SessionFound = z.strictObject({ status: z.literal("accepted"), summary: SessionSummary });
export type SessionFound = z.infer<typeof SessionFound>;

export const SessionGetResult = z.discriminatedUnion("status", [SessionFound, Rejected]);
export type SessionGetResult = z.infer<typeof SessionGetResult>;

export const TranscriptRead = z.strictObject({ status: z.literal("accepted"), page: TranscriptPage });
export type TranscriptRead = z.infer<typeof TranscriptRead>;

export const TranscriptReadResult = z.discriminatedUnion("status", [TranscriptRead, Rejected]);
export type TranscriptReadResult = z.infer<typeof TranscriptReadResult>;

export const AttachmentRead = z.strictObject({
	status: z.literal("accepted"),
	image: ImageContent,
	width: z.int().positive().optional(),
	height: z.int().positive().optional(),
	originalBytes: z.int().nonnegative().optional(),
	resized: z.boolean().optional(),
});
export type AttachmentRead = z.infer<typeof AttachmentRead>;

export const AttachmentReadResult = z.discriminatedUnion("status", [AttachmentRead, Rejected]);
export type AttachmentReadResult = z.infer<typeof AttachmentReadResult>;
