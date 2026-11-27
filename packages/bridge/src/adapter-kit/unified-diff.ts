/**
 * A unified diff of one file from its text before and after, for agents that report an edit as both texts (an ACP
 * `diff` content). Lines are matched by Myers' algorithm after the common head and tail are set aside; past
 * `MAX_EDIT_DISTANCE` changed lines the middle is shown as removed whole and added whole, which is still a true diff.
 */

import { clip, MAX_TEXT_CHARS } from "../contract";

export interface DiffText {
	readonly diff: string;
	readonly additions: number;
	readonly deletions: number;
}

const CONTEXT = 3;
const MAX_EDIT_DISTANCE = 1_000;
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;
type Op = typeof KEEP | typeof DELETE | typeof INSERT;

interface Line {
	readonly op: Op;
	readonly text: string;
	/** Lines of each side before this one. */
	readonly before: readonly [number, number];
}

/** Without `oldText` the file is new. Identical texts give an empty diff. */
export function unifiedDiff(path: string, oldText: string | undefined, newText: string): DiffText {
	const before = oldText === undefined ? [] : linesOf(oldText);
	const after = linesOf(newText);
	const lines = linesWithOps(before, after);
	const additions = lines.filter((line) => line.op === INSERT).length;
	const deletions = lines.filter((line) => line.op === DELETE).length;
	if (additions + deletions === 0) return { diff: "", additions, deletions };
	const header = `--- ${oldText === undefined ? "/dev/null" : path}\n+++ ${path}`;
	const hunks = hunkRanges(lines).map(([start, end]) => hunkText(lines.slice(start, end)));
	return { diff: clip([header, ...hunks].join("\n"), MAX_TEXT_CHARS), additions, deletions };
}

function linesOf(text: string): string[] {
	if (text === "") return [];
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

function linesWithOps(a: readonly string[], b: readonly string[]): Line[] {
	let head = 0;
	while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
	let tail = 0;
	while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
		tail += 1;
	}
	const middleA = a.slice(head, a.length - tail);
	const middleB = b.slice(head, b.length - tail);
	const middle = editScript(middleA, middleB) ?? [...middleA.map((): Op => DELETE), ...middleB.map((): Op => INSERT)];
	const ops: Op[] = [
		...a.slice(0, head).map((): Op => KEEP),
		...middle,
		...a.slice(a.length - tail).map((): Op => KEEP),
	];
	const lines: Line[] = [];
	let i = 0;
	let j = 0;
	for (const op of ops) {
		lines.push({ op, text: op === INSERT ? (b[j] ?? "") : (a[i] ?? ""), before: [i, j] });
		if (op !== INSERT) i += 1;
		if (op !== DELETE) j += 1;
	}
	return lines;
}

/** The shortest edit script from `a` to `b`, or undefined when it is longer than `MAX_EDIT_DISTANCE`. */
function editScript(a: readonly string[], b: readonly string[]): Op[] | undefined {
	const max = Math.min(a.length + b.length, MAX_EDIT_DISTANCE);
	const offset = max + 1;
	const v = new Int32Array(2 * max + 3);
	const trace: Int32Array[] = [];
	for (let d = 0; d <= max; d += 1) {
		trace.push(v.slice());
		for (let k = -d; k <= d; k += 2) {
			const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0));
			let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1;
			let y = x - k;
			while (x < a.length && y < b.length && a[x] === b[y]) {
				x += 1;
				y += 1;
			}
			v[offset + k] = x;
			if (x >= a.length && y >= b.length) return backtrack(trace, offset, a.length, b.length);
		}
	}
	return undefined;
}

function backtrack(trace: readonly Int32Array[], offset: number, n: number, m: number): Op[] {
	const ops: Op[] = [];
	let x = n;
	let y = m;
	for (let d = trace.length - 1; d >= 0; d -= 1) {
		const v = trace[d] ?? new Int32Array(0);
		const k = x - y;
		const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0));
		const previousK = down ? k + 1 : k - 1;
		const previousX = v[offset + previousK] ?? 0;
		const previousY = previousX - previousK;
		while (x > previousX && y > previousY) {
			ops.push(KEEP);
			x -= 1;
			y -= 1;
		}
		if (d > 0) ops.push(x === previousX ? INSERT : DELETE);
		x = previousX;
		y = previousY;
	}
	return ops.reverse();
}

/** `[start, end)` of each hunk: changed lines with `CONTEXT` lines around them, merged where contexts meet. */
function hunkRanges(lines: readonly Line[]): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	lines.forEach((line, at) => {
		if (line.op === KEEP) return;
		const start = Math.max(0, at - CONTEXT);
		const end = Math.min(lines.length, at + CONTEXT + 1);
		const last = ranges.at(-1);
		if (last !== undefined && start <= last[1]) last[1] = end;
		else ranges.push([start, end]);
	});
	return ranges;
}

function hunkText(lines: readonly Line[]): string {
	const first = lines[0];
	const oldCount = lines.filter((line) => line.op !== INSERT).length;
	const newCount = lines.filter((line) => line.op !== DELETE).length;
	const oldStart = (first?.before[0] ?? 0) + (oldCount > 0 ? 1 : 0);
	const newStart = (first?.before[1] ?? 0) + (newCount > 0 ? 1 : 0);
	const body = lines.map((line) => `${line.op === KEEP ? " " : line.op === DELETE ? "-" : "+"}${line.text}`);
	return [`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body].join("\n");
}
