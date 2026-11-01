/**
 * One-off probe for Q4: which sends get `command_lifecycle` frames — with and without a `uuid`, with and
 * without `--replay-user-messages`. Run: `bun scripts/cc-spike/probe-lifecycle.ts`.
 */
import { lifecycleFrames } from "../../src/__tests__/claude-code/spike/rig/interrupt";
import { startSpike } from "../../src/__tests__/claude-code/spike/rig/session";

for (const replay of [false, true]) {
	for (const withUuid of [true, false]) {
		const spike = startSpike({
			permissionMode: "default",
			turns: [{ text: ["ok"] }],
			options: replay ? { extraArgs: { "replay-user-messages": null } } : {},
		});
		try {
			spike.send("hi", withUuid ? {} : { uuid: undefined });
			await spike.waitFor((m) => m.type === "result");
			await Bun.sleep(300);
			const replays = spike.messages.filter((m) => m.type === "user" && "isReplay" in m && m.isReplay).length;
			console.log(JSON.stringify({ replay, withUuid, lifecycle: lifecycleFrames(spike.messages).map((f) => f.state), replays }));
		} finally {
			await spike.close();
		}
	}
}
