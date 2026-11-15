/**
 * A session id as Pi mints one (`createSessionId`, pi-coding-agent 1.5.2 `dist/core/session-manager.js:12-14`): a
 * UUIDv7 (RFC 9562 §5.7), the time in its first 48 bits and random bits after the version and variant.
 */
export function uuidv7(now: number): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	let time = now;
	for (let index = 5; index >= 0; index--) {
		bytes[index] = time % 256;
		time = Math.floor(time / 256);
	}
	bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
	bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
