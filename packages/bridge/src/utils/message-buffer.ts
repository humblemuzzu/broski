/**
 * Ring buffer for recent messages sent to clients.
 * Enables message replay after reconnect to prevent data loss.
 */

type BufferedMessage = {
	seq: number;
	message: any;
	timestamp: number;
};

const MAX_BUFFER_SIZE = 200;
const MAX_BUFFER_AGE_MS = 5 * 60 * 1000; // 5 minutes

// Per-client buffers keyed by client session token
const clientBuffers = new Map<string, BufferedMessage[]>();
let globalSeq = 0;

/**
 * Record a message that was sent to a specific client.
 * Called after each send() in the server.
 */
export function recordMessage(clientId: string, message: any): number {
	const seq = ++globalSeq;

	let buffer = clientBuffers.get(clientId);
	if (!buffer) {
		buffer = [];
		clientBuffers.set(clientId, buffer);
	}

	buffer.push({ seq, message, timestamp: Date.now() });

	// Trim to max size
	if (buffer.length > MAX_BUFFER_SIZE) {
		buffer.splice(0, buffer.length - MAX_BUFFER_SIZE);
	}

	return seq;
}

/**
 * Get all messages after a given sequence number for a client.
 * Returns messages in order, or empty array if the seq is too old.
 */
export function getMessagesSince(clientId: string, lastSeq: number): any[] {
	const buffer = clientBuffers.get(clientId);
	if (!buffer || buffer.length === 0) return [];

	const now = Date.now();
	// Filter out expired messages first
	const valid = buffer.filter((m) => now - m.timestamp < MAX_BUFFER_AGE_MS);

	// Find messages after lastSeq
	const missed = valid.filter((m) => m.seq > lastSeq);
	return missed.map((m) => ({ ...m.message, _replaySeq: m.seq }));
}

/**
 * Get the current sequence number for a client.
 */
export function getCurrentSeq(clientId: string): number {
	const buffer = clientBuffers.get(clientId);
	if (!buffer || buffer.length === 0) return globalSeq;
	return buffer[buffer.length - 1]!.seq;
}

/**
 * Clean up buffer for a disconnected client.
 * Called when a client disconnects — keep the buffer briefly for reconnect.
 */
export function markClientDisconnected(_clientId: string): void {
	// Don't delete immediately — keep for reconnect window.
	// The age-based expiry in cleanupExpiredBuffers() handles eventual removal.
}

/**
 * Completely remove a client's buffer (e.g., on explicit logout).
 */
export function removeClientBuffer(clientId: string): void {
	clientBuffers.delete(clientId);
}

/**
 * Clean up old buffers periodically.
 */
export function cleanupExpiredBuffers(): void {
	const now = Date.now();
	for (const [clientId, buffer] of clientBuffers) {
		// Remove expired messages
		const valid = buffer.filter((m) => now - m.timestamp < MAX_BUFFER_AGE_MS);
		if (valid.length === 0) {
			clientBuffers.delete(clientId);
		} else {
			clientBuffers.set(clientId, valid);
		}
	}
}
