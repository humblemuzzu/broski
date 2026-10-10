/**
 * The daemon's stdout is `/dev/null`, so the startup banner and the pairing endpoints have to reach
 * the log — while the auth token, which only the QR encodes, stays out of it.
 */

import { describe, expect, it } from "bun:test";
import { type ConnectionInfo, displayBanner, displayQRCode } from "../qr";

const TOKEN = "SECRET-TOKEN-abcdef0123456789";
const CERT = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

const INFO: ConnectionInfo = {
	localIP: "192.168.1.20",
	tailscaleIP: "100.101.102.103",
	magicDNS: "mac.tailnet.ts.net",
	funnelURL: "https://mac.tailnet.ts.net",
	hotspotIP: "172.20.10.2",
	port: 9091,
	version: "9.9.9",
	authToken: TOKEN,
	tlsEnabled: true,
	certSha256: CERT,
};

type Collector = { lines: string[]; write: (line: string) => void };

function collector(): Collector {
	const lines: string[] = [];
	return { lines, write: (line) => lines.push(line) };
}

describe("daemon-mode pairing output", () => {
	it("logs the endpoints without the token or the QR payload", () => {
		const sink = collector();
		displayQRCode(INFO, { write: sink.write, includeQr: false });
		const out = sink.lines.join("\n");

		expect(out).toContain("wss://192.168.1.20:9091");
		expect(out).toContain("wss://172.20.10.2:9091");
		expect(out).toContain("wss://100.101.102.103:9091");
		expect(out).toContain("wss://mac.tailnet.ts.net:9091");
		expect(out).toContain("https://mac.tailnet.ts.net");
		expect(out).not.toContain(TOKEN);
		expect(out).not.toContain(CERT);
		expect(out, "the QR block is what would carry the token").not.toContain("█");
	});

	it("renders the banner and the QR on the console when no sink is given", () => {
		const original = console.log;
		const sink = collector();
		console.log = sink.write;
		try {
			displayQRCode(INFO);
			displayBanner();
		} finally {
			console.log = original;
		}

		const out = sink.lines.join("\n");
		expect(out).toContain("Scan this QR code with the Broski app:");
		expect(out).toContain("█");
		expect(out).toContain("wss://192.168.1.20:9091");
		expect(out).toContain("Vibe code from anywhere.");
	});

	it("sends the banner to the sink it is given", () => {
		const sink = collector();
		displayBanner(sink.write);

		const out = sink.lines.join("\n");
		expect(out).toContain("Vibe code from anywhere.");
		expect(out).not.toContain(TOKEN);
	});
});
