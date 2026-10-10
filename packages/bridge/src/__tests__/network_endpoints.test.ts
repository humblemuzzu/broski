import { describe, expect, test } from "bun:test";
import { interfaceFingerprint, readLocalEndpoints } from "../network";
import { type EndpointSnapshot, EndpointWatcher } from "../network/endpoint-watcher";
import {
	createTailscaleStatusCache,
	findTailscaleIpv4,
	type InterfaceMap,
	isCgnatAddress,
	parseTailscaleStatus,
} from "../network/tailscale";

const flush = () => Bun.sleep(1);

function fakeInterval(): { start: (fn: () => void) => () => void; tick: () => void; stops: number } {
	let current: (() => void) | null = null;
	let stops = 0;
	return {
		start: (fn: () => void) => {
			current = fn;
			return () => {
				stops++;
				current = null;
			};
		},
		tick: () => current?.(),
		get stops() {
			return stops;
		},
	};
}

describe("tailscale address detection", () => {
	test("matches only the CGNAT 100.64.0.0/10 range", () => {
		expect(isCgnatAddress("100.64.0.1")).toBe(true);
		expect(isCgnatAddress("100.101.102.103")).toBe(true);
		expect(isCgnatAddress("100.127.255.255")).toBe(true);
		expect(isCgnatAddress("100.63.255.255")).toBe(false);
		expect(isCgnatAddress("100.128.0.0")).toBe(false);
		expect(isCgnatAddress("10.0.0.4")).toBe(false);
		expect(isCgnatAddress("100.64")).toBe(false);
		expect(isCgnatAddress("not-an-ip")).toBe(false);
	});

	test("reads the address from the tunnel interface without a CLI", () => {
		const interfaces: InterfaceMap = {
			en0: [{ family: "IPv4", address: "192.168.1.20" }],
			utun3: [
				{ family: "IPv4", address: "100.121.5.9" },
				{ family: "IPv6", address: "fd7a:115c::1" },
			],
		};
		expect(findTailscaleIpv4(interfaces)).toBe("100.121.5.9");
	});

	test("prefers the tunnel interface and ignores loopback entries", () => {
		const interfaces: InterfaceMap = {
			en0: [{ family: "IPv4", address: "100.90.0.1" }],
			utun9: [
				{ family: "IPv4", address: "100.91.0.5", internal: true },
				{ family: "IPv4", address: "100.92.0.6" },
			],
		};
		expect(findTailscaleIpv4(interfaces)).toBe("100.92.0.6");
	});

	test("returns null when no CGNAT address is present", () => {
		expect(findTailscaleIpv4({ en0: [{ family: "IPv4", address: "192.168.0.5" }] })).toBeNull();
		expect(findTailscaleIpv4({})).toBeNull();
	});
});

describe("parseTailscaleStatus", () => {
	test("extracts IPv4, MagicDNS name, tailnet and connection state", () => {
		const status = parseTailscaleStatus(
			JSON.stringify({
				BackendState: "Running",
				MagicDNSSuffix: "humblemuzzu-tailnet.ts.net",
				Self: { DNSName: "mac-mini.example-tailnet.ts.net.", TailscaleIPs: ["100.101.102.103", "fd7a::1"] },
			}),
		);

		expect(status).toEqual({
			ipv4: "100.101.102.103",
			magicDnsName: "mac-mini.example-tailnet.ts.net",
			tailnetName: "humblemuzzu-tailnet",
			connected: true,
		});
	});

	test("reports a stopped backend as disconnected", () => {
		const status = parseTailscaleStatus(JSON.stringify({ BackendState: "Stopped", Self: {} }));
		expect(status?.connected).toBe(false);
		expect(status?.ipv4).toBeNull();
		expect(status?.magicDnsName).toBeNull();
	});

	test("returns null for unusable CLI output", () => {
		expect(parseTailscaleStatus("not json")).toBeNull();
		expect(parseTailscaleStatus("42")).toBeNull();
	});
});

describe("tailscale status cache", () => {
	test("serves a cached status inside the TTL and refreshes after it", async () => {
		let calls = 0;
		let clock = 0;
		const cache = createTailscaleStatusCache({
			ttlMs: 1000,
			now: () => clock,
			loader: async () => {
				calls++;
				return { ipv4: `100.64.0.${calls}`, magicDnsName: null, tailnetName: null, connected: true };
			},
		});

		expect((await cache.get())?.ipv4).toBe("100.64.0.1");
		clock = 500;
		expect((await cache.get())?.ipv4).toBe("100.64.0.1");
		expect(calls).toBe(1);

		clock = 1500;
		expect((await cache.get())?.ipv4).toBe("100.64.0.2");
		expect(calls).toBe(2);
		expect(cache.last()?.ipv4).toBe("100.64.0.2");
	});

	test("dedupes concurrent lookups and honours force", async () => {
		let calls = 0;
		const cache = createTailscaleStatusCache({
			loader: async () => {
				calls++;
				await flush();
				return { ipv4: "100.64.0.9", magicDnsName: null, tailnetName: null, connected: true };
			},
		});

		await Promise.all([cache.get(), cache.get(), cache.get()]);
		expect(calls).toBe(1);

		await cache.get(true);
		expect(calls).toBe(2);
	});
});

describe("EndpointWatcher", () => {
	test("broadcasts only real endpoint changes", async () => {
		const timers = fakeInterval();
		let endpoints: EndpointSnapshot = { localIP: "192.168.1.5", tailscaleIP: "100.64.0.7", hotspotIP: null };
		const changes: EndpointSnapshot[] = [];

		const watcher = new EndpointWatcher({
			readEndpoints: () => endpoints,
			interfacesFingerprint: () => "fp-1",
			onChange: (snapshot) => changes.push(snapshot),
			interval: { start: timers.start },
		});

		watcher.start();
		timers.tick();
		await flush();
		expect(changes).toEqual([]);

		endpoints = { localIP: "192.168.1.6", tailscaleIP: "100.64.0.7", hotspotIP: null };
		timers.tick();
		await flush();
		expect(changes).toEqual([{ localIP: "192.168.1.6", tailscaleIP: "100.64.0.7", hotspotIP: null }]);
		expect(watcher.snapshot().localIP).toBe("192.168.1.6");

		timers.tick();
		await flush();
		expect(changes.length).toBe(1);
	});

	test("does not fork the Tailscale CLI while an interface address exists", async () => {
		const timers = fakeInterval();
		let cliCalls = 0;

		const watcher = new EndpointWatcher({
			readEndpoints: () => ({ localIP: "10.0.0.2", tailscaleIP: "100.70.1.1", hotspotIP: null }),
			interfacesFingerprint: () => "fp",
			resolveTailscaleViaCli: async () => {
				cliCalls++;
				return "100.70.1.1";
			},
			onChange: () => {},
			interval: { start: timers.start },
		});

		watcher.start();
		for (let i = 0; i < 50; i++) timers.tick();
		await flush();

		expect(cliCalls).toBe(0);
	});

	test("falls back to the CLI at startup and again when interfaces change", async () => {
		const timers = fakeInterval();
		let fingerprint = "fp-1";
		let cliCalls = 0;
		const changes: EndpointSnapshot[] = [];

		const watcher = new EndpointWatcher({
			readEndpoints: () => ({ localIP: "10.0.0.2", tailscaleIP: null, hotspotIP: null }),
			interfacesFingerprint: () => fingerprint,
			resolveTailscaleViaCli: async () => {
				cliCalls++;
				return "100.111.0.1";
			},
			onChange: (snapshot) => changes.push(snapshot),
			interval: { start: timers.start },
		});

		watcher.start();
		await flush();
		expect(cliCalls).toBe(1);
		expect(changes.at(-1)?.tailscaleIP).toBe("100.111.0.1");

		for (let i = 0; i < 20; i++) timers.tick();
		await flush();
		expect(cliCalls).toBe(1);

		fingerprint = "fp-2";
		timers.tick();
		await flush();
		expect(cliCalls).toBe(2);
	});

	test("stop cancels the timer", () => {
		const timers = fakeInterval();
		const watcher = new EndpointWatcher({
			readEndpoints: () => ({ localIP: "10.0.0.2", tailscaleIP: "100.70.1.1", hotspotIP: null }),
			interfacesFingerprint: () => "fp",
			onChange: () => {},
			interval: { start: timers.start },
		});

		watcher.start();
		expect(timers.stops).toBe(0);
		watcher.stop();
		expect(timers.stops).toBe(1);
	});
});

describe("readLocalEndpoints", () => {
	test("derives local, tailscale and hotspot endpoints from one interface snapshot", () => {
		const interfaces: InterfaceMap = {
			en0: [{ family: "IPv4", address: "192.168.1.20" }],
			utun4: [{ family: "IPv4", address: "100.88.4.4" }],
			bridge100: [{ family: "IPv4", address: "172.20.10.3" }],
		};

		expect(readLocalEndpoints(interfaces)).toEqual({
			localIP: "192.168.1.20",
			tailscaleIP: "100.88.4.4",
			hotspotIP: "172.20.10.3",
		});
	});

	test("fingerprint changes when the interface list changes", () => {
		const before = interfaceFingerprint({ en0: [{ family: "IPv4", address: "192.168.1.20" }] });
		const after = interfaceFingerprint({ en0: [{ family: "IPv4", address: "192.168.1.21" }] });
		expect(before).not.toBe(after);
		expect(interfaceFingerprint({ en0: [{ family: "IPv4", address: "10.0.0.1" }] })).toBe(
			interfaceFingerprint({ en0: [{ family: "IPv4", address: "10.0.0.1" }] }),
		);
	});
});
