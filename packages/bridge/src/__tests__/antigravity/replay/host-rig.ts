/**
 * A session the production host (`live/host.ts`) hosts on the live front of a recording. It opens on the recorded
 * `initialize` and `session/new` or `session/load`, sent through the rpc as `acp/connection.ts` and `live/hosts.ts` send
 * them. Then, wherever the recording shows the bridge speaking, the phone does what made the bridge say it: chooses the
 * setting, sends the prompt or the compaction, answers the ask, stops the turn. A load goes as `live/hosts.ts` sends it
 * (`live/load.ts`): its replay's facts (the context fill, the commands, the title) reach the host, its history not. The
 * host of a loaded session holds its first prompt for agy to settle the load (`live/settle.ts`) only when given
 * `settle`; without it the prompt goes where the recording shows it.
 */

import { expect } from "bun:test";
import { z } from "zod";
import { InitializeResult, NewSessionResult } from "../../../backends/antigravity/acp/frames";
import { AgyHost, type HostDeps } from "../../../backends/antigravity/live/host";
import { loadSession } from "../../../backends/antigravity/live/load";
import { PhonePrompts } from "../../../backends/antigravity/live/phone-prompts";
import type { SettleBounds } from "../../../backends/antigravity/live/settle";
import { ANTIGRAVITY_TRAITS } from "../../../backends/antigravity/traits";
import type {
	ActionResult,
	CatalogEvent,
	Interaction,
	InteractionReply,
	PromptInput,
	PromptResult,
	SinkRecord,
} from "../../../contract";
import { streamViolations } from "../../../contract/testing/stream-rules";
import { frontOf, recording } from "./recordings";
import { type Act, Replay } from "./replay";

const NOW = Date.UTC(2026, 10, 27, 12);

/** What the host is given that the replay reads nothing of: its lock, the bridge's other parts, the image fitter. */
const otherDeps = () =>
	({
		lock: { tryLock: () => true, release: () => undefined },
		prompts: new PhonePrompts(async (data, mimeType) => ({
			ok: true,
			data,
			mimeType,
			originalBytes: data.length,
			resized: false,
		})),
		catalogChanged: () => undefined,
		now: () => NOW,
		ran: () => undefined,
		prompted: () => undefined,
		viewChanged: () => undefined,
		ended: () => undefined,
	}) satisfies Partial<HostDeps>;

export interface Phone {
	/** The person's reply to the ask whose answer the recording shows next. */
	readonly reply?: (ask: Interaction) => InteractionReply;
	/** The recorded prompt is the phone's compaction. */
	readonly compacts?: boolean;
}

const NewParams = z.object({ cwd: z.string() });
const LoadParams = z.object({ sessionId: z.string(), cwd: z.string() });
const Choice = z.object({ configId: z.string(), value: z.string() });
const Prompt = z.object({
	prompt: z.array(
		z.union([
			z.object({ type: z.literal("text"), text: z.string() }),
			z.object({ type: z.literal("image"), mimeType: z.string(), data: z.string() }),
		]),
	),
});

export async function hostedReplay(scenario: string, phone: Phone = {}, settle?: SettleBounds) {
	const front = frontOf(recording(scenario));
	const replay = new Replay(front);
	const agent = await replay.request("initialize", InitializeResult);
	const { facts, ...opened } = await opening(replay);
	const catalog: CatalogEvent[] = [];
	const commands: string[][] = [];
	const host = new AgyHost(
		{
			...otherDeps(),
			agy: replay.process(agent),
			catalog: { emit: (event) => catalog.push(event) },
			commandsAnnounced: (_cwd, announced) => commands.push(announced.map((command) => command.name)),
			log: (message) => replay.faults.push(message),
			...(facts !== undefined && settle !== undefined && { settle }),
		},
		{ ...opened, origin: "broski", title: undefined, updatedAt: NOW },
	);
	for (const update of facts ?? []) host.replayed(update);
	const initial = host.snapshot();
	const records: SinkRecord[] = [];
	host.attach({ emit: (record) => records.push(record) });
	const results: Array<ActionResult | PromptResult | Promise<ActionResult>> = [];
	const act: Act = (recorded) => results.push(phoneAction(host, recorded, phone));
	return {
		host,
		front,
		catalog,
		commands,
		play: (until?: Parameters<Replay["play"]>[1]) => replay.play(act, until),
		/** What the host has written to agy that the replay has not yet held to the recording. */
		unmatched: () => replay.unrecorded(),
		events: () => records.map((record) => record.event),
		/**
		 * The recording played to its end: the host sent agy what the bridge did and nothing more, met no fault, kept the
		 * contract's stream rules, and took every action of the phone's.
		 */
		asRecorded: async () => {
			await replay.play(act);
			expect(replay.unrecorded()).toEqual([]);
			expect(replay.faults).toEqual([]);
			expect(streamViolations(records, ANTIGRAVITY_TRAITS, initial)).toEqual([]);
			for (const result of await Promise.all(results)) expect(result).toMatchObject({ status: "accepted" });
		},
	};
}

async function opening(replay: Replay) {
	const sent = replay.nextSent();
	if (sent?.method === "session/load") {
		const { sessionId, cwd } = LoadParams.parse(sent.params);
		const { loaded, facts } = await replay.sent("session/load", () =>
			loadSession(replay.rpc, { sessionId, cwd, mcpServers: [] }),
		);
		if (!loaded.ok) throw new Error(`agy's recorded answer to session/load did not read: ${loaded.failure.message}`);
		return { sessionId, cwd, options: loaded.result.configOptions ?? [], facts };
	}
	const { cwd } = NewParams.parse(sent?.params);
	const made = await replay.request("session/new", NewSessionResult);
	return { sessionId: made.sessionId, cwd, options: made.configOptions ?? [], facts: undefined };
}

function phoneAction(
	host: AgyHost,
	recorded: Readonly<Record<string, unknown>>,
	phone: Phone,
): ActionResult | PromptResult | Promise<ActionResult> {
	switch (recorded.method) {
		case "session/set_config_option": {
			const { configId, value } = Choice.parse(recorded.params);
			if (configId === "model") return host.setModel(value);
			return configId === "thought_level" ? host.setThinking(value) : host.setMode(configId, value);
		}
		case "session/prompt":
			return phone.compacts ? host.compact(undefined) : host.prompt(promptOf(recorded.params));
		case "session/cancel":
			return host.abort();
		case undefined: {
			const ask = host.snapshot().interactions[0];
			if (ask === undefined) throw new Error("the bridge answered agy here, and no ask is open");
			if (phone.reply === undefined) throw new Error(`the phone has no reply to "${ask.title}"`);
			return host.answer({ interactionId: ask.id, reply: phone.reply(ask) });
		}
		default:
			throw new Error(`the phone does nothing that sends agy ${String(recorded.method)}`);
	}
}

function promptOf(params: unknown): PromptInput {
	const blocks = Prompt.parse(params).prompt;
	return {
		clientRequestId: crypto.randomUUID(),
		mode: "start",
		text: blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
		attachments: blocks.flatMap((block) =>
			block.type === "image" ? [{ kind: "image" as const, mimeType: block.mimeType, data: block.data }] : [],
		),
	};
}
