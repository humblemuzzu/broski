/**
 * The catalog of each directory (`probe.ts`), kept 10 minutes: a probe opens a session, which costs agy seconds when it
 * is cold, and a phone opens its pickers often. Callers asking while a probe runs share it; a failed probe is not kept.
 * Each probe also says whether agy is signed in, which `status()` reports and never finds out itself.
 */

import { isRecord } from "../../../adapter-kit/bounded-json";
import type { CommandSummary, ModeAxis, ModelSummary } from "../../../contract";
import { AUTH_REQUIRED } from "../acp/frames";
import type { RpcFailure, RpcResult } from "../acp/rpc";
import type { ShortJobs } from "../jobs";
import { commandSummaries } from "./commands";
import { modelSummaries } from "./models";
import { modeAxes } from "./modes";
import { type ProbeFacts, probeCatalog, type SessionFacts } from "./probe";

export interface Catalog {
	readonly models: readonly ModelSummary[];
	readonly modes: readonly ModeAxis[];
	readonly commands: readonly CommandSummary[];
}

export type SignIn =
	| { readonly kind: "unknown" }
	| { readonly kind: "signed_in" }
	| { readonly kind: "signed_out"; readonly text: string }
	| { readonly kind: "failed"; readonly text: string };

const KEEP_MS = 10 * 60_000;
const REMEMBERED_CWDS = 16;

export class AgyCatalogs {
	private readonly kept = new Map<string, { readonly at: number; readonly read: Promise<RpcResult<Catalog>> }>();
	private signIn: SignIn = { kind: "unknown" };

	constructor(
		private readonly jobs: ShortJobs,
		/** Where a catalog without a project is probed. */
		private readonly voidDir: string,
		private readonly now: () => number = Date.now,
	) {}

	read(cwd: string | undefined): Promise<RpcResult<Catalog>> {
		const directory = cwd ?? this.voidDir;
		const known = this.kept.get(directory);
		if (known !== undefined && this.now() - known.at < KEEP_MS) return known.read;
		const read = probeCatalog(this.jobs, directory).then((probed) => this.learned(probed));
		const kept = { at: this.now(), read };
		this.kept.delete(directory);
		this.kept.set(directory, kept);
		for (const oldest of this.kept.keys()) {
			if (this.kept.size <= REMEMBERED_CWDS) break;
			this.kept.delete(oldest);
		}
		void read.then((result) => {
			if (!result.ok && this.kept.get(directory) === kept) this.kept.delete(directory);
		});
		return read;
	}

	/** Drops what was probed in `cwd`: agy reports its models or modes changed there. */
	invalidate(cwd: string | undefined): void {
		this.kept.delete(cwd ?? this.voidDir);
	}

	lastSignIn(): SignIn {
		return this.signIn;
	}

	private learned(probed: RpcResult<ProbeFacts>): RpcResult<Catalog> {
		this.signIn = signInOf(probed);
		if (!probed.ok) return probed;
		const facts = probed.result;
		return {
			ok: true,
			result: {
				models: modelSummaries(facts),
				modes: modeAxes(facts.options),
				commands: commandSummaries(facts.commands),
			},
		};
	}
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
