import { z } from "zod";
import * as activity from "./activity";
import * as capabilities from "./capabilities";
import * as catalogEvents from "./catalog-events";
import * as commands from "./commands";
import * as compaction from "./compaction";
import * as content from "./content";
import * as events from "./events";
import * as extensions from "./extensions";
import * as forms from "./forms";
import * as ids from "./ids";
import * as input from "./input";
import * as interactionReplies from "./interaction-replies";
import * as interactions from "./interactions";
import * as json from "./json";
import * as models from "./models";
import * as modes from "./modes";
import * as notice from "./notice";
import * as option from "./option";
import * as paging from "./paging";
import * as planUsage from "./plan-usage";
import * as protocol from "./protocol";
import * as protocolWorkspace from "./protocol-workspace";
import * as queue from "./queue";
import * as readResults from "./read-results";
import * as rejection from "./rejection";
import * as runs from "./runs";
import * as sessions from "./sessions";
import * as snapshot from "./snapshot";
import * as stats from "./stats";
import * as status from "./status";
import * as tools from "./tools";
import * as transcript from "./transcript";
import * as usage from "./usage";
import * as workspaceFiles from "./workspace-files";
import * as workspaceGit from "./workspace-git";
import * as workspaceTerminal from "./workspace-terminal";

/** Every wire-visible schema module. Each exported schema is a named type, its export name the type's id. */
const SCHEMA_MODULES = {
	json,
	ids,
	rejection,
	option,
	content,
	tools,
	forms,
	interactions,
	"interaction-replies": interactionReplies,
	input,
	runs,
	queue,
	usage,
	compaction,
	notice,
	activity,
	extensions,
	models,
	commands,
	modes,
	status,
	paging,
	"plan-usage": planUsage,
	stats,
	sessions,
	transcript,
	snapshot,
	events,
	"catalog-events": catalogEvents,
	capabilities,
	"read-results": readResults,
	"workspace-files": workspaceFiles,
	"workspace-git": workspaceGit,
	"workspace-terminal": workspaceTerminal,
	"protocol-workspace": protocolWorkspace,
	protocol,
};

export interface NamedSchema {
	readonly id: string;
	readonly module: string;
	readonly schema: z.ZodType;
}

export function namedSchemas(): NamedSchema[] {
	const named: NamedSchema[] = [];
	for (const [module, exports] of Object.entries(SCHEMA_MODULES)) {
		for (const [id, value] of Object.entries(exports)) {
			if (value instanceof z.ZodType) named.push({ id, module, schema: value });
		}
	}
	return named;
}

/** A registry holding every named schema under its id, for JSON Schema output. */
export function contractRegistry(): z.core.$ZodRegistry<{ id: string }> {
	const registry = z.registry<{ id: string }>();
	for (const { id, schema } of namedSchemas()) registry.add(schema, { id });
	return registry;
}
