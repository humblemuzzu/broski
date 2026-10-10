export function safeString(value: unknown): string {
	return typeof value === "string" ? value : "";
}
