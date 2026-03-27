/**
 * Head-Tail Buffer Truncation
 *
 * Implements smart truncation that preserves both the beginning and end of long outputs,
 * dropping the middle section. This is useful because the start (command info) and end
 * (results/errors) are usually the most important parts.
 *
 * Based on Codex SDK's head_tail_buffer.rs implementation.
 */

export interface HeadTailResult {
	/** The truncated text with head + middle marker + tail */
	text: string;
	/** Number of lines omitted from the middle */
	omittedLines: number;
	/** Number of bytes omitted from the middle */
	omittedBytes: number;
	/** Whether any truncation occurred */
	wasTruncated: boolean;
}

/**
 * Truncate text keeping the first `headLines` and last `tailLines`, dropping the middle.
 *
 * @param text - The text to truncate
 * @param headLines - Number of lines to keep from the start (default: 50)
 * @param tailLines - Number of lines to keep from the end (default: 30)
 * @returns HeadTailResult with truncated text and metadata
 */
export function headTailTruncate(text: string, headLines = 50, tailLines = 30): HeadTailResult {
	const lines = text.split("\n");
	const totalLines = lines.length;

	// If within limits, return as-is
	if (totalLines <= headLines + tailLines) {
		return {
			text,
			omittedLines: 0,
			omittedBytes: 0,
			wasTruncated: false,
		};
	}

	const head = lines.slice(0, headLines);
	const tail = lines.slice(-tailLines);
	const omittedLines = totalLines - headLines - tailLines;

	// Calculate omitted bytes
	const omittedContent = lines.slice(headLines, -tailLines);
	const omittedBytes = omittedContent.reduce((sum, line) => sum + line.length + 1, 0); // +1 for newline

	const marker = `\n... ${omittedLines} lines (${formatBytes(omittedBytes)}) omitted ...\n`;

	return {
		text: [...head, marker, ...tail].join("\n"),
		omittedLines,
		omittedBytes,
		wasTruncated: true,
	};
}

/**
 * Truncate by bytes, keeping head and tail portions.
 *
 * @param text - The text to truncate
 * @param maxBytes - Maximum total bytes to retain (default: 50KB)
 * @returns HeadTailResult with truncated text and metadata
 */
export function headTailTruncateBytes(text: string, maxBytes = 50 * 1024): HeadTailResult {
	const textBytes = Buffer.byteLength(text, "utf8");

	// If within limits, return as-is
	if (textBytes <= maxBytes) {
		return {
			text,
			omittedLines: 0,
			omittedBytes: 0,
			wasTruncated: false,
		};
	}

	const headBudget = Math.floor(maxBytes / 2);
	const tailBudget = maxBytes - headBudget;

	// Find line boundaries for head
	const lines = text.split("\n");
	const headLines: string[] = [];
	let headBytes = 0;
	for (const line of lines) {
		const lineBytes = Buffer.byteLength(`${line}\n`, "utf8");
		if (headBytes + lineBytes > headBudget) break;
		headLines.push(line);
		headBytes += lineBytes;
	}

	// Find line boundaries for tail
	const tailLines: string[] = [];
	let tailBytes = 0;
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]!;
		const lineBytes = Buffer.byteLength(`${line}\n`, "utf8");
		if (tailBytes + lineBytes > tailBudget) break;
		tailLines.unshift(line);
		tailBytes += lineBytes;
	}

	const omittedLines = lines.length - headLines.length - tailLines.length;
	const omittedBytes = textBytes - headBytes - tailBytes;

	const marker = `\n... ${omittedLines} lines (${formatBytes(omittedBytes)}) omitted ...\n`;

	return {
		text: [...headLines, marker, ...tailLines].join("\n"),
		omittedLines,
		omittedBytes,
		wasTruncated: true,
	};
}

/**
 * Format bytes into human-readable string
 */
function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Check if text appears to be truncated by OpenCode's built-in truncation
 * (looks for "Full output saved to:" pattern)
 */
export function isAlreadyTruncated(text: string): boolean {
	return /Full output saved to:\s*.+$/m.test(text);
}
