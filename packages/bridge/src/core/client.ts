import type { ProtocolVersion } from "../contract";
import type { EncodedFrame } from "./frame";
import type { LiveSession } from "./live-session";
import type { ClientLink, CoreLog } from "./ports";

/** One connected app: whether it said `hello`, and the sessions it views. */
export class CoreClient {
	connected = true;
	/** The client's last `hello` named the bridge's major; nothing else is served before. */
	private agreed = false;
	private readonly attached = new Map<string, LiveSession>();
	/** Attaches under way to sessions not viewed yet, each holding a place under the viewing cap. */
	private reserved = 0;
	private readonly steps = new Map<string, Promise<void>>();

	constructor(
		private readonly link: ClientLink,
		private readonly log: CoreLog,
	) {}

	/** Never throws, so one client's link cannot keep a frame from the others or stop the bookkeeping after it. */
	send(frame: EncodedFrame): void {
		if (!this.connected) return;
		try {
			this.link.send(frame.text);
		} catch (error) {
			this.log.error(`[core] sending a frame to a client failed: ${String(error)}`);
		}
	}

	get negotiated(): boolean {
		return this.agreed;
	}

	/** Records a `hello`; true when its major is the bridge's, which is the only time the client is served. */
	hello(theirs: ProtocolVersion, ours: ProtocolVersion): boolean {
		this.agreed = theirs.major === ours.major;
		return this.agreed;
	}

	/**
	 * Runs `step` after every earlier attach or detach of the same session by this client, so a
	 * detach sent right after an attach acts on the attached session, whatever the open costs.
	 */
	inOrder<T>(key: string, step: () => Promise<T>): Promise<T> {
		const result = (this.steps.get(key) ?? Promise.resolve()).then(step);
		const tail = result.then(
			() => undefined,
			() => undefined,
		);
		this.steps.set(key, tail);
		void tail.then(() => {
			if (this.steps.get(key) === tail) this.steps.delete(key);
		});
		return result;
	}

	/** The session this client views under `key`, once every attach or detach of it already sent has run. */
	async viewing(key: string): Promise<LiveSession | undefined> {
		await this.steps.get(key);
		return this.attached.get(key);
	}

	attachedTo(key: string): LiveSession | undefined {
		return this.attached.get(key);
	}

	/**
	 * Holds a place for one more viewed session, counting the attaches still under way; false when
	 * `limit` places are taken. `release` gives it back once the attach is over, attached or not.
	 */
	reserve(limit: number): boolean {
		if (this.attached.size + this.reserved >= limit) return false;
		this.reserved += 1;
		return true;
	}

	release(): void {
		this.reserved -= 1;
	}

	attach(live: LiveSession): void {
		this.attached.set(live.key, live);
	}

	forget(live: LiveSession): void {
		this.attached.delete(live.key);
	}

	/** Every session this client viewed, which it now views no more. */
	detachAll(): LiveSession[] {
		const sessions = [...this.attached.values()];
		this.attached.clear();
		return sessions;
	}

	/** The client went away: it is sent nothing more. */
	disconnect(): LiveSession[] {
		this.connected = false;
		return this.detachAll();
	}
}
