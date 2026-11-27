import type { ConfigOption } from "../acp/frames";

/** The select option of a category (`model`, `thought_level`, `mode`); an option without a category goes by its id. */
export function configOption(options: readonly ConfigOption[], category: string): ConfigOption | undefined {
	return options.find((option) => option.type === "select" && (option.category ?? option.id) === category);
}
