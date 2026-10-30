import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Pi gives a dialog no origin (every `ctx.ui` is the one bound context, pi-coding-agent
 * `src/core/extensions/runner.ts:884-893`), so an extension command is followed through its async calls: its dialog
 * names no run even mid-run (contract `interactions.ts`). Once it returns, what it left running is attributed by time.
 */
export class CommandScope {
	private readonly storage = new AsyncLocalStorage<{ open: boolean }>();

	async run<T>(command: () => Promise<T>): Promise<T> {
		const scope = { open: true };
		try {
			return await this.storage.run(scope, command);
		} finally {
			scope.open = false;
		}
	}

	get active(): boolean {
		return this.storage.getStore()?.open === true;
	}
}
