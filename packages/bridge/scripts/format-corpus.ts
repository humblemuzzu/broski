/**
 * A seeded corpus for the string checks a form field may name (`email`, `uri`, `date`, `date-time`
 * and `pattern`), each line judged by the contract's own `fieldProblem` under Bun and printed as
 * JSON: `{"check", "text", "pattern"?, "problem"}`. `tool/format_differential.dart` runs it and
 * holds the app's port to every line.
 *
 *   bun scripts/format-corpus.ts [--seed N] [--count N]
 *
 * `--count` is per check; the `uri` check gets twice as many, since its port is the largest.
 */
import { fieldProblem, type StringField, type StringFormat } from "../src/contract";
import {
	DATE_DAYS,
	DATE_JUNK,
	DATE_MONTHS,
	DATE_SEPARATORS,
	DATE_YEARS,
	PATTERN_FRAGMENTS,
	PATTERN_TEXTS,
	TIME_FRACTIONS,
	TIME_JOINS,
	TIME_PARTS,
	TIME_ZONES,
	URL_FRAGMENTS,
	URL_PREFIXES,
} from "./format-corpus/fragments";

const args = process.argv.slice(2);
const option = (name: string, fallback: number): number => {
	const at = args.indexOf(name);
	return at >= 0 ? Number(args[at + 1]) : fallback;
};

/** mulberry32: a small seeded generator, so a corpus is reproduced from its seed. */
function generator(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const random = generator(option("--seed", 1));
const count = option("--count", 20_000);
const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
const joined = (list: readonly string[], most: number): string =>
	Array.from({ length: 1 + Math.floor(random() * most) }, () => pick(list)).join("");

/** Mostly the first of [list], the well-formed choice, so valid strings are common enough to matter. */
const usually = (list: readonly string[]): string => (random() < 0.8 ? (list[0] as string) : pick(list));

function date(): string {
	const separator = (): string => usually(DATE_SEPARATORS);
	return pick(DATE_YEARS) + separator() + pick(DATE_MONTHS) + separator() + pick(DATE_DAYS);
}

function dateTime(): string {
	const part = (): string => (random() < 0.5 ? pick(TIME_PARTS.slice(0, 5)) : pick(TIME_PARTS));
	const time = [part(), part(), part()].join(random() < 0.95 ? ":" : "");
	return date() + usually(TIME_JOINS) + time + pick(TIME_FRACTIONS) + usually(TIME_ZONES);
}

function field(extra: { format?: StringFormat; pattern?: string }): StringField {
	return { kind: "string", key: "k", required: false, hidden: false, when: [], options: [], allowCustom: false, ...extra };
}

function line(check: string, text: string, extra: { format?: StringFormat; pattern?: string }): string {
	const problem = fieldProblem(field(extra), { kind: "text", value: text }) ?? null;
	return JSON.stringify({ check, text, pattern: extra.pattern, problem });
}

const out: string[] = [];
for (let index = 0; index < count * 2; index++) {
	const body = joined(URL_FRAGMENTS, 7);
	const text = random() < 0.4 ? pick(URL_PREFIXES) + body : body;
	out.push(line("uri", text, { format: "uri" }));
}
for (let index = 0; index < count; index++) {
	out.push(line("email", joined(URL_FRAGMENTS, 6), { format: "email" }));
	out.push(line("date", date() + usually(DATE_JUNK), { format: "date" }));
	out.push(line("date-time", dateTime() + usually(DATE_JUNK), { format: "date-time" }));
	const pattern = joined(PATTERN_FRAGMENTS, 5);
	out.push(line("pattern", joined(PATTERN_TEXTS, 4), { pattern }));
}
await Bun.write(Bun.stdout, `${out.join("\n")}\n`);
