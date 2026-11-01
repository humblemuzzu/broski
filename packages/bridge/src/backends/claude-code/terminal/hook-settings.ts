/**
 * The terminal ask hook inside a Claude settings object (D26): a `PermissionRequest` hook of type `http` to the
 * bridge's loopback URL with the bearer token in a header, that URL added to `allowedHttpHookUrls` only when the user
 * keeps such a list (D123: creating one would block every other HTTP hook of theirs), and, when the bridge's
 * certificate is self-signed, the file that vouches for it in `env.NODE_EXTRA_CA_CERTS`. Pure: it takes a parsed
 * settings object and gives a new one, every other key untouched.
 */

import { isRecord } from "../json";

export const HOOK_EVENT = "PermissionRequest";
export const HOOK_PATH = "/cc-terminal-hook";
/** A day: the hook request stays open while a person decides; the CLI's own timeout is its withdrawal. */
export const TERMINAL_HOOK_TIMEOUT_SECONDS = 86_400;
const CA_ENV = "NODE_EXTRA_CA_CERTS";
const STATUS_MESSAGE = "Waiting for the Broski app (or answer here)";
const OWN_URL = /^https?:\/\/127\.0\.0\.1:\d{1,5}\/cc-terminal-hook$/;

export type Settings = Record<string, unknown>;

export interface HookSpec {
	/** `https://127.0.0.1:<port>/cc-terminal-hook` */
	readonly url: string;
	readonly token: string;
	readonly timeoutSeconds: number;
	/** The PEM file that vouches for a self-signed certificate; `NODE_EXTRA_CA_CERTS` points at it. */
	readonly caCertPath?: string;
}

type Refused = { readonly ok: false; readonly reason: string };
export type Edit = { readonly ok: true; readonly settings: Settings } | Refused;

export function isOwnUrl(value: unknown): value is string {
	return typeof value === "string" && OWN_URL.test(value);
}

export function withHook(settings: Settings, spec: HookSpec): Edit {
	if (!isOwnUrl(spec.url)) return refuse(`the hook url must be https://127.0.0.1:<port>${HOOK_PATH}`);
	const hooks = hooksOf(settings.hooks);
	if (!hooks.ok) return hooks;
	const allowed = allowedUrls(settings.allowedHttpHookUrls);
	if (!allowed.ok) return allowed;
	const env = spec.caCertPath === undefined ? undefined : withCa(settings.env, spec.caCertPath);
	if (env !== undefined && !env.ok) return env;
	if (allowed.present && allowed.others.length === 0 && allowed.ours === 0) {
		return refuse('"allowedHttpHookUrls" is empty: these settings let no HTTP hook run');
	}
	const next: Settings = { ...settings };
	next.hooks = { ...hooks.all, [HOOK_EVENT]: [...hooks.kept, hookGroup(spec)] };
	if (allowed.present && allowed.others.length > 0) next.allowedHttpHookUrls = [...allowed.others, spec.url];
	else delete next.allowedHttpHookUrls;
	if (env !== undefined) next.env = env.env;
	return { ok: true, settings: next };
}

/** `caCertPath`: the file `withHook` was given, whose `NODE_EXTRA_CA_CERTS` entry goes too. Nothing of ours: unchanged. */
export function withoutHook(settings: Settings, caCertPath?: string): Edit {
	const hooks = hooksOf(settings.hooks);
	if (!hooks.ok) return hooks;
	const allowed = allowedUrls(settings.allowedHttpHookUrls);
	if (!allowed.ok) return allowed;
	const next: Settings = { ...settings };
	if (hooks.removed > 0) dropHooks(next, hooks);
	if (allowed.ours > 0) {
		if (allowed.others.length > 0) next.allowedHttpHookUrls = allowed.others;
		else delete next.allowedHttpHookUrls;
	}
	if (caCertPath !== undefined) dropCa(next, caCertPath);
	return { ok: true, settings: next };
}

interface HooksView {
	readonly ok: true;
	readonly all: Settings;
	/** The event's groups with ours taken out. */
	readonly kept: unknown[];
	/** How many of our hooks the event held. */
	readonly removed: number;
}

function hooksOf(hooks: unknown): HooksView | Refused {
	if (hooks !== undefined && !isRecord(hooks)) return refuse('"hooks" is not an object');
	const all: Settings = isRecord(hooks) ? hooks : {};
	const event = all[HOOK_EVENT];
	if (event !== undefined && !Array.isArray(event)) return refuse(`"hooks.${HOOK_EVENT}" is not a list`);
	let removed = 0;
	const kept = (event ?? []).flatMap((group: unknown) => {
		const result = withoutOurs(group);
		removed += result.removed;
		return result.groups;
	});
	return { ok: true, all, kept, removed };
}

/** A group minus our hooks; a group that held only ours goes. */
function withoutOurs(group: unknown): { groups: unknown[]; removed: number } {
	if (!isRecord(group) || !Array.isArray(group.hooks)) return { groups: [group], removed: 0 };
	const rest = group.hooks.filter((hook: unknown) => !(isRecord(hook) && hook.type === "http" && isOwnUrl(hook.url)));
	const removed = group.hooks.length - rest.length;
	if (removed === 0) return { groups: [group], removed: 0 };
	return { groups: rest.length === 0 ? [] : [{ ...group, hooks: rest }], removed };
}

function dropHooks(next: Settings, hooks: HooksView): void {
	const { [HOOK_EVENT]: _event, ...others } = hooks.all;
	if (hooks.kept.length > 0) next.hooks = { ...others, [HOOK_EVENT]: hooks.kept };
	else if (Object.keys(others).length > 0) next.hooks = others;
	else delete next.hooks;
}

function hookGroup(spec: HookSpec): Settings {
	return {
		hooks: [
			{
				type: "http",
				url: spec.url,
				timeout: spec.timeoutSeconds,
				headers: { Authorization: `Bearer ${spec.token}` },
				statusMessage: STATUS_MESSAGE,
			},
		],
	};
}

type Allowed =
	| { readonly ok: true; readonly present: boolean; readonly others: string[]; readonly ours: number }
	| Refused;

function allowedUrls(value: unknown): Allowed {
	if (value === undefined) return { ok: true, present: false, others: [], ours: 0 };
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		return refuse('"allowedHttpHookUrls" is not a list of strings');
	}
	const others = value.filter((url) => !isOwnUrl(url));
	return { ok: true, present: true, others, ours: value.length - others.length };
}

function withCa(env: unknown, caCertPath: string): { readonly ok: true; readonly env: Settings } | Refused {
	if (env !== undefined && !isRecord(env)) return refuse('"env" is not an object');
	const current = isRecord(env) ? env[CA_ENV] : undefined;
	if (current !== undefined && current !== caCertPath) {
		return refuse(`${CA_ENV} in the settings already names another file, which the terminal's hook would not trust`);
	}
	return { ok: true, env: { ...(isRecord(env) ? env : {}), [CA_ENV]: caCertPath } };
}

function dropCa(settings: Settings, caCertPath: string): void {
	const env = settings.env;
	if (!isRecord(env) || env[CA_ENV] !== caCertPath) return;
	const { [CA_ENV]: _removed, ...rest } = env;
	if (Object.keys(rest).length > 0) settings.env = rest;
	else delete settings.env;
}

function refuse(reason: string): Refused {
	return { ok: false, reason };
}
