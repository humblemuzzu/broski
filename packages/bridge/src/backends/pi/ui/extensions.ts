/**
 * The inline extensions a hosted session loads through `DefaultResourceLoader({extensionFactories})`
 * (D15): the built-ins the `pi` command loads, as it loads them, then the session's hidden gate.
 */

import {
	createCodemodeExtension,
	createMcpExtension,
	createToolSearchExtension,
	type InlineExtension,
} from "@earendil-works/pi-coding-agent";

/** As pi-coding-agent `src/extensions/index.ts:7-13` declares them, minus `llama.cpp`, which has no root export. */
export function builtinExtensions(): InlineExtension[] {
	return [
		{ name: "codemode", factory: createCodemodeExtension(), replaceable: true, builtin: true },
		{ name: "tool-search", factory: createToolSearchExtension(), replaceable: true, builtin: true },
		{ name: "mcp", factory: createMcpExtension(), replaceable: true, builtin: true },
	];
}

export function sessionExtensions(gate: InlineExtension): InlineExtension[] {
	return [...builtinExtensions(), gate];
}
