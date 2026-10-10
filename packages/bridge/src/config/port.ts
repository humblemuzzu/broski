export const PORT_MIN = 0;
export const PORT_MAX = 65535;
export const DEFAULT_PORT = 18274;

export function parsePort(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number(value);
	if (Number.isInteger(parsed) && parsed >= PORT_MIN && parsed <= PORT_MAX) return parsed;
	console.warn(
		`[config] Ignoring invalid port ${JSON.stringify(value)}; expected an integer between ${PORT_MIN} and ${PORT_MAX}. Using ${fallback}.`,
	);
	return fallback;
}
