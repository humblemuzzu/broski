/** Every event a live state emits, in order, with a way to wait for the next one of a type. */

import { AgentEvent, type SessionSink } from "../../contract";

export type EventOf<T extends AgentEvent["type"]> = Extract<AgentEvent, { type: T }>;

const WAIT_MS = 4_000;

export class EventLog {
	readonly events: AgentEvent[] = [];
	readonly trace: string[] = [];
	/** What the contract's schema said against an event, for each one it refused. */
	readonly invalid: string[] = [];
	private readonly taken = new Set<AgentEvent>();
	private readonly watchers = new Set<() => void>();
	readonly sink: SessionSink = {
		emit: (record) => {
			this.events.push(record.event);
			const parsed = AgentEvent.safeParse(record.event);
			if (!parsed.success) this.invalid.push(`${record.event.type}: ${parsed.error.message}`);
			this.trace.push(`live:${record.event.type}`);
			for (const watcher of [...this.watchers]) watcher();
		},
	};

	of<T extends AgentEvent["type"]>(type: T): EventOf<T>[] {
		return this.events.filter((event): event is EventOf<T> => event.type === type);
	}

	/** The first event of `type` nobody has taken yet; it is taken. */
	next<T extends AgentEvent["type"]>(type: T, test: (event: EventOf<T>) => boolean = () => true): Promise<EventOf<T>> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.watchers.delete(look);
				reject(new Error(`no ${type} within ${WAIT_MS} ms; saw ${this.events.map((event) => event.type).join(", ")}`));
			}, WAIT_MS);
			const look = () => {
				const hit = this.of(type).find((event) => !this.taken.has(event) && test(event));
				if (hit === undefined) return;
				this.taken.add(hit);
				clearTimeout(timer);
				this.watchers.delete(look);
				resolve(hit);
			};
			this.watchers.add(look);
			look();
		});
	}
}
