// @ts-expect-error -- qrcode-terminal has no type declarations
import qrcode from "qrcode-terminal";

export interface ConnectionInfo {
	localIP: string | null;
	tailscaleIP: string | null;
	magicDNS: string | null;
	funnelURL: string | null;
	hotspotIP: string | null;
	port: number;
	version: string;
	authToken: string;
	tlsEnabled?: boolean;
	certSha256?: string | null;
}

export type BannerSink = (line: string) => void;

export type QrDisplayOptions = {
	/**
	 * Where the human-readable lines go. Defaults to the console.
	 *
	 * The daemon's stdout is `/dev/null`, so a daemon passes the logger here to keep the endpoints
	 * in the log.
	 */
	write?: BannerSink;
	/**
	 * Whether to render the QR itself. The QR payload carries the auth token, so a log target must
	 * pass `false`.
	 */
	includeQr?: boolean;
};

export function displayQRCode(info: ConnectionInfo, options: QrDisplayOptions = {}): void {
	const data = JSON.stringify({
		l: info.localIP,
		t: info.tailscaleIP,
		m: info.magicDNS,
		f: info.funnelURL,
		h: info.hotspotIP,
		p: info.port,
		v: info.version,
		a: info.authToken,
		s: info.tlsEnabled ? 1 : 0,
		c: info.certSha256 ?? null,
	});

	const write: BannerSink = options.write ?? ((line) => console.log(line));

	if (options.includeQr ?? true) {
		write("\n");
		write("  Scan this QR code with the Broski app:");
		write("");

		qrcode.generate(data, { small: true }, (qr: string) => {
			for (const line of qr.split("\n")) write(`    ${line}`);
		});
	} else {
		write("");
		write("  Pair the Broski app with one of these endpoints:");
	}

	write("");
	write("  Or connect manually:");
	const scheme = info.tlsEnabled ? "wss" : "ws";
	if (info.localIP) {
		write(`  - Local:     ${scheme}://${info.localIP}:${info.port}`);
	}
	if (info.hotspotIP) {
		write(`  - Hotspot:   ${scheme}://${info.hotspotIP}:${info.port}`);
	}
	if (info.tailscaleIP) {
		write(`  - Tailscale: ${scheme}://${info.tailscaleIP}:${info.port}`);
	}
	if (info.magicDNS) {
		write(`  - MagicDNS:  ${scheme}://${info.magicDNS}:${info.port}`);
	}
	if (info.funnelURL) {
		write(`  - Public:    ${info.funnelURL}`);
	}
	write("");
}

export function displayBanner(write: BannerSink = (line) => console.log(line)): void {
	write(`
  ╔══════════════════════════════════════════════════════════╗
  ║                                                          ║
  ║   ██████╗ ██████╗  ██████╗ ███████╗██╗  ██╗██╗           ║
  ║   ██╔══██╗██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝██║           ║
  ║   ██████╔╝██████╔╝██║   ██║███████╗█████╔╝ ██║           ║
  ║   ██╔══██╗██╔══██╗██║   ██║╚════██║██╔═██╗ ██║           ║
  ║   ██████╔╝██║  ██║╚██████╔╝███████║██║  ██╗██║           ║
  ║   ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝           ║
  ║                                                          ║
  ║              Vibe code from anywhere.                    ║
  ║                                                          ║
  ╚══════════════════════════════════════════════════════════╝
  `);
}
