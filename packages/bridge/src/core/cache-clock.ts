import type { CacheWindow, SessionSnapshot, Usage } from "../contract";
import { BoundedMap } from "../state/bounded-map";
import type { CoreClock } from "./ports";

const MAX_TRACKED_WINDOWS = 512;
const WINDOW_TTL_MS = 24 * 60 * 60 * 1_000;

/** One model request's tokens, from the difference between two session totals. */
interface TurnTokens {
	readonly read: number;
	readonly write: number;
	readonly input: number;
}

type HitTokens = Pick<CacheWindow, "cachedTokens" | "promptTokens">;

/**
 * Bridge-wide single source of truth for each session's `Usage.cache`, the prompt cache as the latest model request
 * left it. An adapter that knows the cache's lifetime says so (`ttlMs`, `confidence`) and its window is kept, with a
 * `lastTouchAt` stamped when it gave none and the latest request's tokens taken from the session totals when it gave
 * none; totals that did not move are no request, so the same touch keeps the tokens it had. An adapter that reports only cache read and write totals gets a window from them, stamped when its totals
 * moved and with no lifetime, since none is known. The window outlives the session's close, so a phone that comes
 * back to a warm session still sees its countdown and its hit ratio.
 */
export class CacheClock {
	private readonly windows: BoundedMap<string, CacheWindow>;

	constructor(private readonly clock: CoreClock) {
		this.windows = new BoundedMap({ maxEntries: MAX_TRACKED_WINDOWS, ttlMs: WINDOW_TTL_MS, now: () => clock.now() });
	}

	/** A snapshot the adapter handed over whole: a window it carries is the session's now. */
	adopt(key: string, snapshot: SessionSnapshot): void {
		const cache = snapshot.usage?.cache;
		if (cache) this.windows.set(key, this.stamped(cache));
	}

	/**
	 * `snapshot` with the session's window in place of whatever window it carries. `live` is the window the open session
	 * shows now, for one this clock has let go of (past its bound or its TTL): an open session keeps its window.
	 */
	onto(key: string, snapshot: SessionSnapshot, live: CacheWindow | undefined): SessionSnapshot {
		const cache = this.windows.get(key) ?? live;
		return cache ? { ...snapshot, usage: { ...snapshot.usage, cache } } : snapshot;
	}

	/** A `usage_updated`'s usage as phones get it; `previous` is the session's usage before it. */
	usage(key: string, usage: Usage, previous: Usage | undefined): Usage {
		const turn = turnTokens(usage, previous);
		const next = usage.cache ? this.completed(key, usage.cache, turn) : turn && this.synthesized(turn);
		if (next) this.windows.set(key, next);
		const cache = next ?? this.windows.get(key) ?? previous?.cache;
		return cache ? { ...usage, cache } : usage;
	}

	private stamped(cache: CacheWindow): CacheWindow {
		return cache.lastTouchAt > 0 ? cache : { ...cache, lastTouchAt: this.clock.now() };
	}

	private completed(key: string, cache: CacheWindow, turn: TurnTokens | undefined): CacheWindow {
		const stamped = this.stamped(cache);
		const known = this.hitTokens(key, stamped, turn);
		return {
			...stamped,
			...(cache.cachedTokens === undefined && known.cachedTokens !== undefined && { cachedTokens: known.cachedTokens }),
			...(cache.promptTokens === undefined && known.promptTokens !== undefined && { promptTokens: known.promptTokens }),
		};
	}

	/** The latest request's tokens when the totals moved, else those the stored window of the same touch holds. */
	private hitTokens(key: string, cache: CacheWindow, turn: TurnTokens | undefined): HitTokens {
		if (turn && moved(turn)) return { cachedTokens: turn.read, promptTokens: promptTokens(turn) };
		const stored = this.windows.get(key);
		if (stored?.lastTouchAt !== cache.lastTouchAt) return {};
		return { cachedTokens: stored.cachedTokens, promptTokens: stored.promptTokens };
	}

	/** A window from the totals alone, only when they moved: a request that read or wrote the cache touched it. */
	private synthesized(turn: TurnTokens): CacheWindow | undefined {
		if (turn.read === 0 && turn.write === 0) return undefined;
		return { lastTouchAt: this.clock.now(), cachedTokens: turn.read, promptTokens: promptTokens(turn) };
	}
}

/** The latest request's tokens, from the totals' growth; undefined when the backend reports no cache totals. */
function turnTokens(usage: Usage, previous: Usage | undefined): TurnTokens | undefined {
	if (usage.cacheReadTokens === undefined && usage.cacheWriteTokens === undefined) return undefined;
	return {
		read: growth(usage.cacheReadTokens, previous?.cacheReadTokens),
		write: growth(usage.cacheWriteTokens, previous?.cacheWriteTokens),
		input: growth(usage.inputTokens, previous?.inputTokens),
	};
}

/** Totals that did not grow are a usage sent again, not a request. */
function moved(turn: TurnTokens): boolean {
	return turn.read + turn.write + turn.input > 0;
}

/** `inputTokens` counts what the cache neither read nor wrote, as Anthropic and Pi report it. */
function promptTokens(turn: TurnTokens): number {
	return turn.input + turn.read + turn.write;
}

/** How much a total grew; a total that fell started over, so all of it is new. */
function growth(total: number | undefined, before: number | undefined): number {
	if (total === undefined) return 0;
	return before !== undefined && total >= before ? total - before : total;
}
