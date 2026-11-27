/** What carries one `pi --mode rpc`'s records: the process itself (`child.ts`) or its holder (`holder/link.ts`). */

import type { JsonlItem } from "../../../adapter-kit/jsonl";
import type { ChildExit } from "../../../adapter-kit/stdio-child";

/** `detached`: this bridge lost the `pi`, which may go on under its holder (`replaced`: another bridge took it). */
export type PiEnd =
	| { readonly kind: "exit"; readonly exit: ChildExit; readonly stderr: string }
	| { readonly kind: "detached"; readonly replaced: boolean };

/** `replay` brackets the records a holder kept for a bridge that never read them. */
export type TransportItem = JsonlItem | { readonly kind: "replay"; readonly replaying: boolean };

export type TransportSink = (item: TransportItem) => void;

export interface PiTransport {
	/** Settles after every record before it has reached the sink. */
	readonly ended: Promise<PiEnd>;
	readonly running: boolean;
	write(record: string): void;
	pause(): void;
	resume(): void;
	stop(): Promise<unknown>;
	/** Lets go without ending `pi` where the transport can; a direct child is stopped. */
	detach(): void;
}

export type OpenTransport = (sink: TransportSink) => PiTransport;
