// bun-types 1.4.2 declares `on`/`once`/`addListener`/`prependListener`/`prependOnceListener`/`emit`
// on NodeJS.Process for "memoryPressure" only, which hides the generic EventEmitter signatures it
// inherits from @types/node (oven-sh/bun#40003 restored `off`/`removeListener` but not these). Re-declare
// them mapped over ProcessEventMap so every other process event still typechecks.
import type { ProcessEventMap } from "node:process";

declare global {
	namespace NodeJS {
		interface Process {
			on<K extends keyof ProcessEventMap>(event: K, listener: (...args: ProcessEventMap[K]) => void): this;
			once<K extends keyof ProcessEventMap>(event: K, listener: (...args: ProcessEventMap[K]) => void): this;
			addListener<K extends keyof ProcessEventMap>(event: K, listener: (...args: ProcessEventMap[K]) => void): this;
			prependListener<K extends keyof ProcessEventMap>(event: K, listener: (...args: ProcessEventMap[K]) => void): this;
			prependOnceListener<K extends keyof ProcessEventMap>(
				event: K,
				listener: (...args: ProcessEventMap[K]) => void,
			): this;
			emit<K extends keyof ProcessEventMap>(event: K, ...args: ProcessEventMap[K]): boolean;
		}
	}
}
