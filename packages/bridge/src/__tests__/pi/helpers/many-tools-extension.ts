/** An extension that registers `MANY_TOOLS` tools, each with a long description, to show how a long list is bounded. */

import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const MANY_TOOLS = 1_010;
export const LONG_DESCRIPTION = "d".repeat(5_000);

export default function manyTools(pi: ExtensionAPI): void {
	for (let index = 0; index < MANY_TOOLS; index++) {
		pi.registerTool({
			name: `bulk_${index}`,
			label: `Bulk ${index}`,
			description: LONG_DESCRIPTION,
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "" }], details: {} }),
		});
	}
}
