import type { AgentBackend, BackendHost } from "../backend";
import type { Attachment } from "../content";
import type { CommandId, SessionRef } from "../ids";
import type { InteractionKind } from "../interactions";

export type Feature = "thinking" | "usage" | "plan_proposal" | "children";

/**
 * What the next run of a session must do (see the contract README, "Conformance"). `hold` and
 * `echo_model` wait at their hold until aborted or `release`d; the others end on their own.
 */
export type Scenario =
	| { kind: "reply" }
	| { kind: "tool" }
	| { kind: "hold" }
	| { kind: "interaction"; interaction: InteractionKind }
	| { kind: "feature"; feature: Feature }
	/** Two model requests, each answering with one text block that is exactly the id of the model it ran with. */
	| { kind: "echo_model" };

/** A user message as it reached the model. */
export interface DeliveredInput {
	readonly text: string;
	readonly attachments: readonly Attachment[];
	readonly command?: CommandId;
}

/** Makes a backend behave the way a rule needs. Every adapter has one. */
export interface ConformanceDriver {
	/** A directory holding a file named `README.md`, which attachments point at. */
	readonly cwd: string;
	/** Another directory, whose sessions a listing of `cwd` must leave out. */
	readonly otherCwd: string;
	/** Makes at least `count` finished sessions exist in `cwd`. */
	seedSessions(cwd: string, count: number): Promise<void>;
	/** False when this backend cannot produce `scenario`. */
	arrange(session: SessionRef, scenario: Scenario): Promise<boolean>;
	/** Lets a `hold` go on. */
	release(session: SessionRef): Promise<void>;
	/** Resolves once everything asked of the backend so far has emitted all it will, short of a hold, a human or a run still going. */
	quiesce(): Promise<void>;
	/** The latest user input of the session as it reached the model. */
	delivered(session: SessionRef): Promise<DeliveredInput | undefined>;
	/** Another client of the backend runs one reply in the session; false when no other client can. */
	runExternally(session: SessionRef): Promise<boolean>;
	/**
	 * Another client of the backend raises an ask of a declared kind in a session it owns, one this bridge opens without
	 * `control` but whose asks it answers (`OpenSession.answer`, such as a terminal's permission prompt). Absent, or
	 * undefined, when the backend has no such session; a backend that has them must offer it.
	 */
	watchedAsk?(): Promise<SessionRef | undefined>;
	/** The bridge restarts: the current backend is disposed and a new one starts over the same backend state. */
	restart(host: BackendHost): Promise<AgentBackend>;
}

export interface ConformanceInstance {
	readonly backend: AgentBackend;
	readonly driver: ConformanceDriver;
}

/** A fresh backend and its driver; every rule gets its own. */
export type ConformanceFactory = (host: BackendHost) => Promise<ConformanceInstance>;
