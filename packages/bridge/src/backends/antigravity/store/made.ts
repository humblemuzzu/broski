/**
 * The sessions this bridge made, kept in a journal across restarts (`~/.broski/antigravity/sessions.jsonl`): the folder
 * and settings each was made with, when, whether agy has stored it, and, until it has, the person's first prompt. agy
 * keeps no record of the client that made a session, lists one only once it has stored a prompt of it, and stores none
 * whose first turn was cut off before the model had it (measured on 1.5.18: a bridge restart right after a new chat's
 * first prompt). So this is what says which sessions are Broski's (`origin`), where one agy does not list runs, and what
 * the person wrote in one agy lost, which goes back to them, never to agy (`live/hosts.ts` `replaced`).
 *
 * Each line is a session's whole record as it changed, the last one of a session wins, and a load that read more lines
 * than sessions writes the journal again with one line each, so the person's words stay on disk only until a load after
 * agy stored them.
 */

import { z } from "zod";
import type { Journal, JournalOpener } from "../../../adapter-kit/ports";
import { MAX_TEXT_CHARS, type ModeSetting, NewSessionOptions, SessionId, type SessionOrigin } from "../../../contract";

const REMEMBERED = 10_000;
/** A session writes at most three lines between loads: made, first prompted, stored. */
const KEPT_LINES = 3 * REMEMBERED;

const MadeLine = z.strictObject({
	sessionId: SessionId,
	at: z.number().finite(),
	options: NewSessionOptions,
	stored: z.literal(true).optional(),
	firstPrompt: z.string().max(MAX_TEXT_CHARS).optional(),
	/** The first prompt is one agy lost in the session this one replaces, handed back and not sent in this one yet. */
	carried: z.literal(true).optional(),
	/** The session this one was made in place of, which is gone. */
	replaces: SessionId.optional(),
});
type MadeLine = z.infer<typeof MadeLine>;

export type MadeSession = Omit<MadeLine, "sessionId" | "replaces">;

/** The settings a session runs with, as a new session is made with them. */
export interface ChosenSettings {
	readonly modelId?: string;
	readonly thinking?: string;
	readonly modes: readonly ModeSetting[];
}

export class MadeSessions {
	private readonly made = new Map<string, MadeSession>();
	private readonly journal: Journal<MadeLine>;

	constructor(open: JournalOpener) {
		this.journal = open("sessions", MadeLine, KEPT_LINES);
		const lines = this.journal.load();
		for (const line of lines) this.apply(line);
		if (lines.length > this.made.size) {
			this.journal.rewrite([...this.made].map(([sessionId, session]) => ({ sessionId, ...session })));
		}
	}

	/** A session the bridge made now; one made in place of `replaces` takes over its first prompt, unsent. */
	note(sessionId: string, options: NewSessionOptions, at: number, replaces?: string): void {
		const lost = replaces === undefined ? undefined : this.made.get(replaces)?.firstPrompt;
		this.write({
			sessionId,
			at,
			options,
			...(lost !== undefined && { firstPrompt: lost, carried: true }),
			...(replaces !== undefined && { replaces }),
		});
	}

	/** The person sent `text` in the session: its first prompt, while agy has stored none of it. */
	prompted(sessionId: string, text: string, settings: ChosenSettings): void {
		const session = this.made.get(sessionId);
		if (session === undefined || session.stored || (session.firstPrompt !== undefined && !session.carried)) return;
		const { at, options } = session;
		this.write({
			sessionId,
			at,
			options: { ...settings, modes: [...settings.modes], cwd: options.cwd },
			firstPrompt: text,
		});
	}

	/** agy listed these sessions: it has stored them, so nothing of theirs needs keeping beyond what they are. */
	stored(listed: Iterable<string>): void {
		for (const sessionId of listed) {
			const session = this.made.get(sessionId);
			if (session === undefined || session.stored) continue;
			this.write({ sessionId, at: session.at, options: session.options, stored: true });
		}
	}

	get(sessionId: string): MadeSession | undefined {
		return this.made.get(sessionId);
	}

	/** The sessions agy has not stored, oldest first. */
	unstored(): Array<readonly [string, MadeSession]> {
		return [...this.made].filter(([, session]) => session.stored !== true);
	}

	origin(sessionId: string): SessionOrigin {
		return this.made.has(sessionId) ? "broski" : "external";
	}

	private write(line: MadeLine): void {
		this.apply(line);
		this.journal.append(line);
	}

	private apply({ sessionId, replaces, ...session }: MadeLine): void {
		if (replaces !== undefined) this.made.delete(replaces);
		this.made.delete(sessionId);
		this.made.set(sessionId, session);
		for (const oldest of this.made.keys()) {
			if (this.made.size <= REMEMBERED) break;
			this.made.delete(oldest);
		}
	}
}
