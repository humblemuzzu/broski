/** Lane F · where the CLI reads each config file for a cwd (research 05): settings, `.mcp.json`, CLAUDE.md, agents… */

export interface ConfigPlace {
	readonly id: string;
	readonly path: string;
	readonly scope: string;
	readonly group: string;
	readonly format: "json" | "markdown" | "text";
	readonly editable: boolean;
	/** A directory a new named file goes into (a command, an agent, a skill). */
	readonly template: boolean;
}

export function configPlaces(_configRoot: string, _cwd: string): ConfigPlace[] {
	return [];
}
