/**
 * A local HTTP(S) proxy that forwards nothing: it reads the first request line of every connection
 * (`CONNECT host:443 HTTP/1.1`, or `GET http://host/path HTTP/1.1`), records it, answers 403 and closes.
 * Pointed at by `HTTPS_PROXY`/`HTTP_PROXY`, it turns any request the CLI tries to send past the scripted
 * endpoint into a recorded, failed escape instead of network traffic.
 */

export type ProxyTrap = {
	url: string;
	/** First request lines seen, e.g. `CONNECT statsig.anthropic.com:443 HTTP/1.1`. */
	attempts: () => string[];
	stop: () => void;
};

const MAX_HEAD = 8192;
const REFUSAL = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

export function startProxyTrap(onAttempt: (line: string) => void = () => {}): ProxyTrap {
	const attempts: string[] = [];
	const heads = new WeakMap<object, string>();
	const answered = new WeakSet<object>();
	const listener = Bun.listen({
		hostname: "127.0.0.1",
		port: 0,
		socket: {
			data(socket, data) {
				if (answered.has(socket)) return;
				const head = (heads.get(socket) ?? "") + data.toString("latin1");
				heads.set(socket, head);
				const end = head.indexOf("\r\n");
				if (end < 0 && head.length < MAX_HEAD) return;
				const line = head.slice(0, end < 0 ? 200 : end);
				answered.add(socket);
				attempts.push(line);
				onAttempt(line);
				socket.end(REFUSAL);
			},
			error() {},
		},
	});
	return {
		url: `http://127.0.0.1:${listener.port}`,
		attempts: () => [...attempts],
		stop: () => listener.stop(true),
	};
}
