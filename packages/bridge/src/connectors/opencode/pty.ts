import type { PtySession } from "../../types";
import type { OpenCodeContext } from "./context";
import { getInstanceDirectory } from "./instance";
import { mapPtySession } from "./mappers";

export async function listPty(ctx: OpenCodeContext, directory?: string): Promise<PtySession[]> {
	try {
		const dir = directory ?? (await getInstanceDirectory(ctx));
		const { data: result } = await ctx.client.pty.list({ directory: dir ?? undefined });
		return (result ?? []).map((pty: any) => mapPtySession(pty));
	} catch (error) {
		console.error("[PTY] listPty failed:", error);
		return [];
	}
}

export async function createPty(
	ctx: OpenCodeContext,
	command?: string,
	args?: string[],
	cwd?: string,
	title?: string,
	env?: Record<string, string>,
	directory?: string,
): Promise<PtySession | null> {
	try {
		const dir = directory ?? (await getInstanceDirectory(ctx));
		const { data: result } = await ctx.client.pty.create({
			directory: dir ?? undefined,
			...(command ? { command } : {}),
			...(args ? { args } : {}),
			...(cwd ? { cwd } : {}),
			...(title ? { title } : {}),
			...(env && Object.keys(env).length > 0 ? { env } : {}),
		});
		return result ? mapPtySession(result) : null;
	} catch (error) {
		console.error("[PTY] createPty failed:", error);
		return null;
	}
}

export async function getPty(ctx: OpenCodeContext, ptyId: string, directory?: string): Promise<PtySession | null> {
	try {
		const dir = directory ?? (await getInstanceDirectory(ctx));
		const { data: result } = await ctx.client.pty.get({ ptyID: ptyId, directory: dir ?? undefined });
		return result ? mapPtySession(result) : null;
	} catch (error) {
		console.error("[PTY] getPty failed:", error);
		return null;
	}
}

export async function updatePty(
	ctx: OpenCodeContext,
	ptyId: string,
	title?: string,
	rows?: number,
	cols?: number,
	directory?: string,
): Promise<PtySession | null> {
	try {
		const dir = directory ?? (await getInstanceDirectory(ctx));
		const { data: result } = await ctx.client.pty.update({
			ptyID: ptyId,
			directory: dir ?? undefined,
			...(title ? { title } : {}),
			...(rows && cols ? { size: { rows, cols } } : {}),
		});
		return result ? mapPtySession(result) : null;
	} catch (error) {
		console.error("[PTY] updatePty failed:", error);
		return null;
	}
}

export async function deletePty(ctx: OpenCodeContext, ptyId: string, directory?: string): Promise<boolean> {
	try {
		const dir = directory ?? (await getInstanceDirectory(ctx));
		await ctx.client.pty.remove({ ptyID: ptyId, directory: dir ?? undefined });
		return true;
	} catch (error: any) {
		console.error("[PTY] deletePty failed:", error?.message || error);
		// Return true if it's a 404 (already deleted)
		if (error?.response?.status === 404) {
			return true;
		}
		return false;
	}
}

export function getPtyWebSocketUrl(ctx: OpenCodeContext, ptyId: string, directory?: string): string {
	// The /connect suffix is required - it's the WebSocket upgrade endpoint
	const wsUrl = ctx.baseUrl.replace("http", "ws");
	const baseWsUrl = `${wsUrl}/pty/${ptyId}/connect`;
	if (directory) {
		return `${baseWsUrl}?directory=${encodeURIComponent(directory)}`;
	}
	return baseWsUrl;
}
