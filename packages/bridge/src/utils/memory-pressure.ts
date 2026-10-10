/**
 * Bun emits `memoryPressure` when the OS reports low memory, with `"critical"` reserved for the
 * kernel's harder threshold. This listener does not keep the event loop alive.
 */

export type MemoryPressureLevel = "warning" | "critical";

export function onMemoryPressure(listener: (level: MemoryPressureLevel) => void): () => void {
	const handler = (level: MemoryPressureLevel): void => listener(level);
	process.on("memoryPressure", handler);
	return () => {
		process.off("memoryPressure", handler);
	};
}
