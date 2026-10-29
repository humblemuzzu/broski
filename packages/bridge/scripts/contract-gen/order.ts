/** Orders strings by UTF-16 code units, the same in every locale, so generated files never reorder by themselves. */
export function byCodeUnits(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
