import { describe, expect, test } from "bun:test";
import { broskiServerPids } from "../platform/broski-processes";

const BIN = "/Users/me/.broski/bin";

/** `ps -ax -o pid=,command=` from a Mac running an installed Broski next to work that merely mentions it. */
const PS = `
  101 ${BIN}/broski-link run --bridge-cmd ${BIN}/broski --daemon
  102 ${BIN}/broski --daemon --link-socket /Users/me/.broski/link/bridge.sock --link-key-file /Users/me/.broski/link/bridge.key
  103 ${BIN}/broski
  104 ${BIN}/broski serve --port 18274
  201 ${BIN}/broski __pi-holder /Users/me/.broski/pi-hosts/acb205fdc4f3
  202 ${BIN}/broski update
  203 ${BIN}/broski --version
  204 ${BIN}/broski-link status
  205 ${BIN}/broski-link pair
  301 tail -f /Users/me/.broski/logs/bridge.log
  302 vim ${BIN}/broski
  303 /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild archive -project /Users/me/src/broski/apps/ios/Broski/Broski.xcodeproj
  304 tmux new-session -d -s broski-daemon
  305 /Users/me/src/broski/packages/link/target/release/broski-relay --listen 127.0.0.1:8766
  306 bun test src/__tests__/broski-processes.test.ts
  307 /bin/sh /var/folders/xy/T/broski-update-AbC123/install.sh
  308 ${BIN}/broski-linkage run
  999 ${BIN}/broski restart
`;

describe("broskiServerPids", () => {
	test("ends the bridge servers and link daemons of the install, and nothing that merely mentions broski", () => {
		expect(broskiServerPids(PS, `${BIN}/broski`, 999)).toEqual([101, 102, 103, 104]);
	});

	test("finds a source checkout's bridge, run as `bun <script>`, but not other bun processes", () => {
		const script = "/Users/me/src/broski/packages/bridge/bin/broski.ts";
		const ps = `
  401 bun ${script} --daemon --link-socket /Users/me/.broski/link/bridge.sock
  402 /Users/me/.bun/bin/bun ${script} __pi-holder /Users/me/.broski/pi-hosts/1
  403 node ${script} --daemon
  404 bun test ${script}
`;
		expect(broskiServerPids(ps, script, 0)).toEqual([401]);
	});
});
