/**
 * What agy offers, read only to answer a read the person asked for, never on a timer. The models, each with its own
 * thinking levels, and the modes are the account's and the `agy` binary's, not a folder's: one catalog probe
 * (`probe.ts`) reads them, kept until the binary changes (its file stamp) or a hosted session sees agy offer others
 * (`invalidate`). The commands are a folder's (its workspace skills): those that probe's session was offered in the
 * folder it ran in, else a commands probe's in the folder asked, kept for the bridge's life until the binary changes or
 * a hosted session there is announced others (`announced`). Callers asking while a probe runs share it; a failed probe
 * is not kept. Each probe also says whether agy is signed in, which `status()` reports and never finds out itself.
 */

import { isRecord } from "../../../adapter-kit/bounded-json";
import type { CommandSummary, ModeAxis, ModelSummary } from "../../../contract";
import { AUTH_REQUIRED } from "../acp/frames";
import type { RpcFailure, RpcResult } from "../acp/rpc";
import type { ShortJobs } from "../jobs";
import { commandSummaries } from "./commands";
import { modelSummaries } from "./models";
import { modeAxes } from "./modes";
import { type ProbeFacts, probeCatalog, probeCommands, type SessionFacts } from "./probe";

export interface Offered {
	readonly models: readonly ModelSummary[];
	readonly modes: readonly ModeAxis[];
}

export type SignIn =
	| { readonly kind: "unknown" }
	| { readonly kind: "signed_in" }
	| { readonly kind: "signed_out"; readonly text: string }
	| { readonly kind: "failed"; readonly text: string };

interface Kept<T> {
	/** The binary's stamp when it was read. */
	readonly stamp: string;
	readonly read: Promise<RpcResult<T>>;
}

type Commands = readonly CommandSummary[];

const REMEMBERED_CWDS = 64;

export class AgyCatalogs {
	private offers: Kept<Offered> | undefined;
	private readonly folders = new Map<string, Kept<Commands>>();
	private signIn: SignIn = { kind: "unknown" };

	constructor(
		private readonly jobs: ShortJobs,
		/** Where a catalog without a project is probed. */
		private readonly voidDir: string,
		/** The `agy` binary's file stamp: another one is another `agy`, which may offer otherwise. */
		private readonly stamp: () => Promise<string>,
	) {}

	async offered(cwd: string | undefined): Promise<RpcResult<Offered>> {
		const stamp = await this.stamp();
		const kept = this.offers?.stamp === stamp ? this.offers : this.probe(cwd ?? this.voidDir, stamp).offers;
		return kept.read;
	}

	async commands(cwd: string | undefined): Promise<RpcResult<Commands>> {
		const directory = cwd ?? this.voidDir;
		const stamp = await this.stamp();
		const known = this.folders.get(directory);
		if (known?.stamp === stamp) return known.read;
		if (this.offers?.stamp !== stamp) return this.probe(directory, stamp).commands.read;
		const read = probeCommands(this.jobs, directory).then((probed): RpcResult<Commands> => {
			this.signIn = signInOf(probed);
			return probed.ok ? { ok: true, result: commandSummaries(probed.result.commands) } : probed;
		});
		return this.keepCommands(directory, { stamp, read }).read;
	}

	/** Drops the models and modes: a hosted session saw agy offer others. */
	invalidate(): void {
		this.offers = undefined;
	}

	/** The commands agy announced to a hosted session in `cwd`, which a new session there is offered too. */
	async announced(cwd: string | undefined, commands: Commands): Promise<void> {
		const stamp = await this.stamp();
		this.keepCommands(cwd ?? this.voidDir, { stamp, read: Promise.resolve({ ok: true, result: commands }) });
	}

	lastSignIn(): SignIn {
		return this.signIn;
	}

	/** One catalog probe in `directory`: the models and modes, and that folder's commands. */
	private probe(directory: string, stamp: string): { offers: Kept<Offered>; commands: Kept<Commands> } {
		const probed = probeCatalog(this.jobs, directory).then((read) => {
			this.signIn = signInOf(read);
			return read;
		});
		const offers: Kept<Offered> = {
			stamp,
			read: probed.then((read) => (read.ok ? { ok: true, result: offeredOf(read.result) } : read)),
		};
		this.offers = offers;
		void offers.read.then((read) => {
			if (!read.ok && this.offers === offers) this.offers = undefined;
		});
		const commands: Kept<Commands> = {
			stamp,
			read: probed.then((read) => (read.ok ? { ok: true, result: commandSummaries(read.result.commands) } : read)),
		};
		return { offers, commands: this.keepCommands(directory, commands) };
	}

	private keepCommands(directory: string, kept: Kept<Commands>): Kept<Commands> {
		this.folders.delete(directory);
		this.folders.set(directory, kept);
		for (const oldest of this.folders.keys()) {
			if (this.folders.size <= REMEMBERED_CWDS) break;
			this.folders.delete(oldest);
		}
		void kept.read.then((read) => {
			if (!read.ok && this.folders.get(directory) === kept) this.folders.delete(directory);
		});
		return kept;
	}
}

function offeredOf(facts: ProbeFacts): Offered {
	return { models: modelSummaries(facts), modes: modeAxes(facts.options) };
}

/** `_meta.antigravity.tier` names the plan of the account agy runs on, and comes only with a sign-in. */
export function signInOf(probed: RpcResult<SessionFacts>): SignIn {
	if (!probed.ok) {
		const { failure } = probed;
		return isAuthFailure(failure)
			? { kind: "signed_out", text: failure.message }
			: { kind: "failed", text: failure.message };
	}
	const antigravity = probed.result.meta?.antigravity;
	const tier = isRecord(antigravity) ? antigravity.tier : undefined;
	return tier === undefined || tier === null ? { kind: "unknown" } : { kind: "signed_in" };
}

function isAuthFailure(failure: RpcFailure): boolean {
	return failure.code === AUTH_REQUIRED || (failure.code !== undefined && /\bauth/i.test(failure.message));
}
