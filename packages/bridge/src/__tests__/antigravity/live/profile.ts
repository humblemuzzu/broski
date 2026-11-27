/**
 * The agy profile every live test runs in, and the proof that agy runs there on the developer's Gemini API key. Google
 * permits no program to write or drive agy's prompts on a consumer sign-in, and supports automation on a Gemini API key
 * (antigravity README, "Google's rules"), so the real `agy` is only ever started with a temp folder of its own in place
 * of `~/.gemini` (`--gemini-dir`) and of its app data (`--app-data-dir`): nothing of the user's agy (sign-in state,
 * settings, conversations, trust list, presence locks) is read or written. The app data folder is the profile's
 * `antigravity-cli`, where a default agy keeps its settings and presence locks under `~/.gemini`, so the one settings
 * file, `{"modelProvider": "gemini"}` (antigravity.google/docs/install, "Authenticate"), is where agy reads it whichever
 * of the two flags it reads it under. The key reaches agy only through its environment, from `GEMINI_API_KEY`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../../adapter-kit/bounded-json";
import { resultOf, type WireLog } from "./wire-log";

/** ACP's `authenticate` method agy names for a Gemini API key. */
export const API_KEY_METHOD = "gemini-api-key";
/** The id of the `authenticate` the wire tap sends itself; the backend never sends one. */
export const TAP_AUTH_ID = "broski-tap-auth";

export interface AgyProfile {
	readonly root: string;
	/** `--gemini-dir`. */
	readonly geminiDir: string;
	/** `--app-data-dir`. */
	readonly appDataDir: string;
	/** Where agy in this profile holds a conversation's presence lock. */
	readonly presenceDir: string;
}

export function agyProfile(root: string): AgyProfile {
	const geminiDir = join(root, "gemini");
	const appDataDir = join(geminiDir, "antigravity-cli");
	return { root, geminiDir, appDataDir, presenceDir: join(appDataDir, "presence") };
}

/** The profile's folders and its settings, made under `root`. */
export function madeProfile(root: string): AgyProfile {
	const profile = agyProfile(root);
	mkdirSync(profile.appDataDir, { recursive: true, mode: 0o700 });
	writeFileSync(join(profile.appDataDir, "settings.json"), `${JSON.stringify({ modelProvider: "gemini" })}\n`);
	return profile;
}

/** What every `agy` the tests start is given after its own arguments. */
export function profileFlags(profile: AgyProfile): string[] {
	return ["--gemini-dir", profile.geminiDir, "--app-data-dir", profile.appDataDir];
}

/** The developer's key, which the gate requires before any live test starts. */
export function apiKey(): string {
	const key = process.env.GEMINI_API_KEY?.trim();
	if (!key) throw new Error("GEMINI_API_KEY is not set: agy runs here only on a Gemini API key");
	return key;
}

/** `text` with the key replaced, for anything written or shown. */
export function withoutApiKey(text: string): string {
	const key = process.env.GEMINI_API_KEY?.trim();
	return key ? text.replaceAll(key, "<GEMINI_API_KEY>") : text;
}

export const CONSUMER_SIGN_IN = "agy is on the consumer sign-in; live tests run only on a Gemini API key";

/**
 * Throws unless every `agy acp` the backend has been answered `initialize` by took the Gemini API key first (the tap
 * holds that answer back until agy has answered its `authenticate`) and no answer of agy's names a plan: on a Google
 * sign-in, `_meta.antigravity.tier` carries the plan's name. Called before every prompt.
 */
export function assertApiKey(tap: WireLog): void {
	const started = tap.exchanges("initialize").filter((exchange) => exchange.answer !== undefined);
	const auths = tap.exchanges("authenticate", undefined, "tap");
	for (const { agy } of started) {
		const auth = auths.find((exchange) => exchange.agy.tapPid === agy.tapPid);
		if (auth?.answer === undefined) throw new Error(`agy ${agy.pid} was not sent the Gemini API key's authenticate`);
		const { error } = auth.answer.message;
		if (error !== undefined) throw new Error(`agy ${agy.pid} refused the Gemini API key: ${JSON.stringify(error)}`);
		for (const frame of agy.frames) {
			if (frame.from === "agent" && planOf(resultOf(frame)) !== undefined) throw new Error(CONSUMER_SIGN_IN);
		}
	}
}

function planOf(result: Readonly<Record<string, unknown>> | undefined): unknown {
	const meta = result?._meta;
	const antigravity = isRecord(meta) ? meta.antigravity : undefined;
	const tier = isRecord(antigravity) ? antigravity.tier : undefined;
	return tier === null || tier === "" ? undefined : tier;
}
