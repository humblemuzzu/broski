import type { OpenCodeContext } from "./context";

export async function isRunning(ctx: OpenCodeContext): Promise<boolean> {
	try {
		const response = await fetch(`${ctx.baseUrl}/path`, {
			signal: AbortSignal.timeout(750),
		});
		return response.ok;
	} catch {
		return false;
	}
}

export async function getInstanceDirectory(ctx: OpenCodeContext): Promise<string | null> {
	try {
		const response = await fetch(`${ctx.baseUrl}/path`, {
			signal: AbortSignal.timeout(2000),
		});
		if (!response.ok) return null;
		const data = await response.json();
		return data.directory ?? null;
	} catch {
		return null;
	}
}

export async function disposeInstance(ctx: OpenCodeContext, directory?: string): Promise<boolean> {
	try {
		const { data: result } = await ctx.client.instance.dispose({ directory });
		return result === true;
	} catch {
		return false;
	}
}

export async function getHealth(ctx: OpenCodeContext): Promise<{ healthy: boolean; version: string } | null> {
	try {
		const { data } = await ctx.client.global.health();
		return data ?? null;
	} catch {
		return null;
	}
}
