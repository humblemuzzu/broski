/**
 * The agy profile every live test runs in, and the proof that agy runs there on the developer's Gemini API key. Google
 * permits no program to write or drive agy's prompts on a consumer sign-in, and supports automation on a Gemini API key
 * (antigravity README, "Google's rules"), so the real `agy` only ever runs in a temp folder standing in for the user's
 * home: nothing of the user's agy (sign-in, settings, conversations, trust list, presence locks) is read or written.
 * `agy acp` takes it as `--gemini-dir <root>/.gemini --app-data-dir antigravity-cli`: agy 1.5.18 resolves the app data
 * dir under the gemini dir and refuses an absolute one ("must not be absolute"). The terminal `agy` takes neither flag,
 * so it is started with `HOME=<root>`, whose default `~/.gemini/antigravity-cli` is the same folder. The settings are
 * `{"modelProvider": "gemini"}` (antigravity.google/docs/install, "Authenticate"); the key reaches agy only through
 * its environment, from `GEMINI_API_KEY`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../../adapter-kit/bounded-json";
import type { WireLog } from "./wire-log";

/** ACP's `authenticate` method agy names for a Gemini API key. */
export const API_KEY_METHOD = "gemini-api-key";
/** The id of the `authenticate` the wire tap sends itself; the backend never sends one. */
export const TAP_AUTH_ID = "broski-tap-auth";
/** `--app-data-dir`, agy's own default name for it. */
const APP_DATA_DIR = "antigravity-cli";

export interface AgyProfile {
	/** The home the terminal `agy` is started with. */
	readonly root: string;
	/** `--gemini-dir`: the profile's `~/.gemini`. */
	readonly geminiDir: string;
	/** Where agy in this profile keeps its settings and cache. */
	readonly appDataDir: string;
	/** Where agy in this profile holds a conversation's presence lock. */
	readonly presenceDir: string;
}

export function agyProfile(root: string): AgyProfile {
	const geminiDir = join(root, ".gemini");
	const appDataDir = join(geminiDir, APP_DATA_DIR);
	return { root, geminiDir, appDataDir, presenceDir: join(appDataDir, "presence") };
}

/** The profile's folders and its settings, made under `root`. */
export function madeProfile(root: string): AgyProfile {
	const profile = agyProfile(root);
	mkdirSync(profile.appDataDir, { recursive: true, mode: 0o700 });
	writeSettings(profile, {});
	return profile;
}

/** Has the profile's terminal `agy` trust `folder`, which it would otherwise ask about before opening anything there. */
export function trustFolder(profile: AgyProfile, folder: string): void {
	writeSettings(profile, { trustedWorkspaces: [folder] });
}

function writeSettings(profile: AgyProfile, extra: Readonly<Record<string, unknown>>): void {
	const settings = { modelProvider: "gemini", ...extra };
	writeFileSync(join(profile.appDataDir, "settings.json"), `${JSON.stringify(settings)}\n`);
}

/**
 * What the wire tap starts the real `agy` with when the backend asks for `args`: `agy acp` in the profile, and
 * `agy --version`, which reads no profile, as it is. The backend starts `agy` no other way.
 */
export function tappedArgs(args: readonly string[], profile: AgyProfile): string[] {
	if (args[0] === "acp") return [...args, "--gemini-dir", profile.geminiDir, "--app-data-dir", APP_DATA_DIR];
	if (args.length === 1 && args[0] === "--version") return [...args];
	throw new Error(`the wire tap starts agy only as \`agy acp\` or \`agy --version\`, not with ${JSON.stringify(args)}`);
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
 * holds that answer back until agy has answered its `authenticate`) and no answer of agy's names a plan; the tap
 * itself stops an `agy` at the first answer that names one, before the backend sees it.
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
			if (frame.from === "agent" && namesPlan(frame.message.result)) throw new Error(CONSUMER_SIGN_IN);
		}
	}
}

/** On a Google sign-in an answer's `_meta.antigravity.tier` names the plan; on a Gemini API key agy sends none. */
export function namesPlan(result: unknown): boolean {
	const meta = isRecord(result) ? result._meta : undefined;
	const antigravity = isRecord(meta) ? meta.antigravity : undefined;
	const tier = isRecord(antigravity) ? antigravity.tier : undefined;
	return tier !== undefined && tier !== null && tier !== "";
}
