import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { FileAttachment } from "../../types";

function _sanitizeFilename(name: string): string {
	const base = basename(name || "attachment");
	return base.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

function _extForMime(mimeType?: string | null): string {
	const mt = (mimeType || "").toLowerCase();
	if (mt === "image/png") return ".png";
	if (mt === "image/jpeg") return ".jpg";
	if (mt === "image/jpg") return ".jpg";
	if (mt === "image/webp") return ".webp";
	if (mt === "image/gif") return ".gif";
	if (mt === "image/bmp") return ".bmp";
	if (mt === "image/tiff") return ".tiff";
	return "";
}

async function _writeImageAttachmentToDisk(cwd: string, attachment: FileAttachment): Promise<string | null> {
	const base64Data = attachment.base64Data;
	if (!base64Data) return null;

	const attachmentsDir = join(cwd, ".broski", "cc-attachments");
	await mkdir(attachmentsDir, { recursive: true });

	const ext =
		_extForMime(attachment.mimeType) || (_sanitizeFilename(attachment.path).match(/\.[a-zA-Z0-9]+$/)?.[0] ?? ".jpg");
	const safeName = _sanitizeFilename(attachment.path || "image");
	const token = randomBytes(6).toString("hex");
	const fileName = safeName.includes(".") ? safeName : `${safeName}${ext}`;
	const outPath = join(attachmentsDir, `${Date.now()}_${token}_${fileName}`);

	const bytes = Buffer.from(base64Data, "base64");
	await writeFile(outPath, bytes);
	return outPath;
}

/**
 * Claude Code SDK doesn't have a first-class "attachments" parameter like OpenCode.
 * To support Broski's attachment UX, we:
 * - Pass file paths as explicit references in the prompt (Claude can Read them)
 * - Persist mobile-picked images to disk under the session cwd and reference them
 */
export async function preparePromptWithAttachments(
	prompt: string,
	cwd: string,
	fileAttachments?: FileAttachment[],
): Promise<string> {
	if (!fileAttachments || fileAttachments.length === 0) return prompt;

	const lines: string[] = [];

	for (const a of fileAttachments) {
		if (a.base64Data) {
			const savedPath = await _writeImageAttachmentToDisk(cwd, a);
			if (savedPath) {
				lines.push(`- Image: @${savedPath}`);
			}
			continue;
		}

		if (!a.path) continue;
		const prefix = a.isDirectory ? "Directory" : "File";
		const ref = a.path.startsWith("@") ? a.path : `@${a.path}`;
		lines.push(`- ${prefix}: ${ref}`);
	}

	if (lines.length === 0) return prompt;

	return [
		prompt,
		"",
		"---",
		"Attached context (via Broski):",
		...lines,
		"",
		"If relevant, use the Read tool on the @paths above.",
	].join("\n");
}
