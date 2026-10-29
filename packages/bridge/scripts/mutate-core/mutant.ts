/** One change to one guard. `find` must occur exactly once in `file` (a path under `src`). */
export interface Mutant {
	readonly name: string;
	readonly file: string;
	readonly find: string;
	readonly replace: string;
	/** Why the mutant changes nothing a test can see; set only for one expected to survive. */
	readonly equivalent?: string;
}

/** The mutants of one file, written once per file. */
export function mutantsOf(file: string, list: ReadonlyArray<Omit<Mutant, "file">>): Mutant[] {
	return list.map((mutant) => ({ ...mutant, file }));
}
