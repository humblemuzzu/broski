/**
 * The history of a chat the production backend hosts, every `agy` it starts answering as `answering-agy.ts` says. The
 * front makes the session (ACP's documented `session/new` answer, naming the oldest session agy's recorded listing has,
 * so a short job finds it) and streams agy's recorded turns (`plain-turn`, `thinking`, `image-turn`), each answered once
 * the test has read the transcript mid-run, and closes the session as agy closed one (`plain-turn`'s short job). A
 * short job answers as a second agy read a hosted conversation on 1.5.18: its listing, and each `session/load` with a
 * replay of the first turn alone (`load-replay`, agy's replay of that turn), even after the second turn ended. What the
 * phone showed live is the run items the contract's reducer builds from the events, which the phone's core keeps too.
 */

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ListSessionsResult } from "../../backends/antigravity/acp/frames";
import { antigravityBackendOf } from "../../backends/antigravity/backend";
import { UNVIEWED_GRACE_MS } from "../../backends/antigravity/live/unviewed";
import {
	type AgentBackend,
	emptySnapshot,
	type OpenSession,
	type PromptInput,
	type SessionSink,
	type SessionSnapshot,
	type SinkRecord,
	type TranscriptItem,
} from "../../contract";
import { allTranscript } from "../../contract/testing/conformance-reads";
import { fileLock } from "../../platform/file-lock";
import { fitImageBase64 } from "../../platform/image-fit";
import { journalsIn } from "../../server/json-lines-journal";
import { ManualClock } from "../helpers/core-rig";
import { type Answer, AnsweringAgy, recordedAnswer, recordedFrontInitialize, recordedListing } from "./answering-agy";
import { OK_PROMPT } from "./live/runs";
import { promptOf as phonePrompt, runsShown } from "./replay/host-rig";
import { answerTo, recordsOf } from "./replay/recorded";
import { frontOf, jobOf, recording } from "./replay/recordings";

let root: string | undefined;

afterEach(() => {
	if (root !== undefined) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

const LISTED = ListSessionsResult.parse(answerTo(jobOf(recording("listing")), "session/list")).sessions;
const OLDEST = LISTED.toSorted((a, b) => Date.parse(a.updatedAt ?? "") - Date.parse(b.updatedAt ?? ""))[0];
const SESSION_ID = OLDEST?.sessionId ?? "";
const READS = 12;

/** The phone's prompt that had the bridge send agy the `scenario` recording's prompt. */
function promptOf(scenario: string): PromptInput {
	return phonePrompt(recordsOf(frontOf(recording(scenario)), "session/prompt", "client")[0]);
}

/** What reached the phone from the open on. */
class PhoneView {
	initial: SessionSnapshot = emptySnapshot();
	private readonly records: SinkRecord[] = [];
	private ended: (() => void) | undefined;

	readonly sink: SessionSink = {
		emit: (record) => {
			this.records.push(record);
			if (record.event.type === "run_finished") this.ended?.();
		},
	};

	/** The items each run showed live as it finished. */
	runs(): TranscriptItem[][] {
		return runsShown(this.initial, this.records);
	}

	runFinished(): Promise<void> {
		return new Promise((resolve) => {
			this.ended = resolve;
		});
	}
}

function answers(answer: Answer): Answer[] {
	return Array.from({ length: READS }, () => answer);
}

function hostedChat() {
	root = realpathSync(mkdtempSync(join(tmpdir(), "broski-agy-history-")));
	const cwd = join(root, "project");
	mkdirSync(cwd);
	const replay = jobOf(recording("load-replay"));
	const closed = { result: answerTo(jobOf(recording("plain-turn")), "session/close") };
	const listing = recordedListing(cwd);
	const agy = new AnsweringAgy(
		{
			initialize: [recordedFrontInitialize()],
			"session/new": [{ result: { sessionId: SESSION_ID } }],
			"session/close": [closed],
		},
		{
			initialize: listing.initialize ?? [],
			"session/list": answers(listing["session/list"]?.[0] ?? { result: {} }),
			"session/load": answers(recordedAnswer(replay, "session/load", SESSION_ID)),
			"session/close": answers(closed),
		},
	);
	const clock = new ManualClock();
	const faults: string[] = [];
	const backend = antigravityBackendOf(
		{
			install: {
				cli: { found: false, reason: "every agy here answers from recordings" },
				env: {},
				voidDir: join(root, "void"),
				presenceDir: join(root, "presence"),
			},
			bridgeVersion: "0.0.0-test",
			fileLock,
			fitImage: fitImageBase64,
			journal: journalsIn(join(root, "antigravity"), (message) => faults.push(message)),
			launch: agy.launch,
			log: (message) => faults.push(message),
			clock,
		},
		{ catalog: { emit: () => undefined } },
	);
	return { cwd, agy, clock, faults, backend };
}

async function newestFirst(backend: AgentBackend): Promise<TranscriptItem[]> {
	const read = await backend.readTranscript({ backend: "antigravity", sessionId: SESSION_ID }, { limit: 200 });
	if (read.status === "rejected") throw new Error(`the transcript was refused: ${read.rejection.message}`);
	expect(read.page.idStability).toBe("positional");
	return read.page.items;
}

/** What the person reads of a transcript, oldest first: their words and agy's answers. */
function words(items: readonly TranscriptItem[]): string[] {
	return items.flatMap((item) => {
		if (item.kind === "user_message") return [`> ${item.text}`];
		return item.kind === "block" && item.block === "text" ? [item.text] : [];
	});
}

/** Each turn of `scenarios` on the hosted chat: the transcript read mid-run, then the moment the run finished. */
async function turns(chat: ReturnType<typeof hostedChat>, session: OpenSession, phone: PhoneView, scenarios: string[]) {
	const reads: { mid: TranscriptItem[]; ended: TranscriptItem[] }[] = [];
	for (const scenario of scenarios) {
		expect(await session.control?.prompt(promptOf(scenario))).toEqual({ status: "accepted", disposition: "started" });
		await Bun.sleep(5);
		const mid = (await newestFirst(chat.backend)).reverse();
		const finished = phone.runFinished();
		chat.agy.answerLate("session/prompt", recordedAnswer(frontOf(recording(scenario)), "session/prompt", SESSION_ID));
		await finished;
		reads.push({ mid, ended: (await newestFirst(chat.backend)).reverse() });
	}
	return reads;
}

async function opened(chat: ReturnType<typeof hostedChat>) {
	const phone = new PhoneView();
	const open = await chat.backend.open({ kind: "new", options: { cwd: chat.cwd } }, phone.sink);
	if (open.status === "rejected") throw new Error(`the open was refused: ${open.rejection.message}`);
	phone.initial = open.snapshot;
	return { phone, session: open.session };
}

/** The chat after the turns of `scenarios`, its view closed and the grace passed, so the bridge had agy close it. */
async function closedAfter(chat: ReturnType<typeof hostedChat>, scenarios: string[]): Promise<TranscriptItem[][]> {
	const { phone, session } = await opened(chat);
	await turns(chat, session, phone, scenarios);
	await session.close();
	chat.clock.advance(UNVIEWED_GRACE_MS);
	await Bun.sleep(5);
	expect(chat.agy.sent(true)).toContain("session/close");
	return phone.runs();
}

test("each turn of a hosted chat is in its transcript the moment it finishes, as the phone showed it, with no agy read", async () => {
	const chat = hostedChat();
	try {
		const { phone, session } = await opened(chat);
		const reads = await turns(chat, session, phone, ["plain-turn", "thinking", "image-turn"]);
		expect(phone.runs()).toHaveLength(3);
		const [first = [], second = [], third = []] = phone.runs();
		expect(words(first)).toEqual([`> ${OK_PROMPT}`, "ok"]);
		const after = [first, [...first, ...second], [...first, ...second, ...third]];
		expect(reads.map((read) => words(read.ended))).toEqual(after.map((items) => words(items)));
		expect(reads.map((read) => read.ended)).toEqual(after);
		expect(reads.map((read) => read.mid)).toEqual([[], first, [...first, ...second]]);

		const ref = { backend: "antigravity", sessionId: SESSION_ID } as const;
		expect(await allTranscript(chat.backend, ref, 1)).toEqual([...first, ...second, ...third].reverse());
		const image = third.find((item) => item.kind === "user_message")?.attachments[0];
		if (image?.kind !== "image_ref") throw new Error("the image turn's message names no image");
		const sent = promptOf("image-turn").attachments[0];
		expect(await chat.backend.readAttachment(ref, image.id)).toMatchObject({ status: "accepted", image: sent });
		expect(chat.agy.sent(false)).not.toContain("session/load");
		expect(chat.faults).toEqual([]);
	} finally {
		await chat.backend.dispose();
	}
});

test("once agy closed a hosted chat, its history is agy's replay when the replay holds every message of the person's", async () => {
	const chat = hostedChat();
	try {
		const [run = []] = await closedAfter(chat, ["plain-turn"]);
		const replayed = (await newestFirst(chat.backend)).reverse();
		expect(chat.agy.sent(false)).toContain("session/load");
		expect(words(replayed)).toEqual(words(run));
		expect(replayed.map((item) => item.id)).toEqual([`${SESSION_ID}:0`, `${SESSION_ID}:1`]);
		const prompt = run.find((item) => item.kind === "user_message");
		if (prompt?.kind !== "user_message") throw new Error("the run showed no prompt");
		expect(replayed[0]).toMatchObject({ kind: "user_message", clientRequestId: prompt.clientRequestId });
		expect(chat.faults).toEqual([]);
	} finally {
		await chat.backend.dispose();
	}
});

test("once agy closed a hosted chat, a replay missing a message of the person's leaves the history its host had", async () => {
	const chat = hostedChat();
	try {
		const hosted = (await closedAfter(chat, ["plain-turn", "thinking"])).flat();
		expect((await newestFirst(chat.backend)).reverse()).toEqual(hosted);
		expect((await newestFirst(chat.backend)).reverse()).toEqual(hosted);
		expect(chat.agy.sent(false).filter((method) => method === "session/load")).toHaveLength(2);
		expect(chat.faults).toEqual([]);
	} finally {
		await chat.backend.dispose();
	}
});
