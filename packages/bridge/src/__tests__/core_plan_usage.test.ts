/** `plan.usage` goes to the bridge's usage reader, not a backend, and is answered once either way. */

import { describe, expect, test } from "bun:test";
import type { PlanUsageResult } from "../contract";
import { startCoreRig } from "./helpers/core-rig";

const READING: PlanUsageResult = {
	status: "accepted",
	meters: [
		{
			plan: "claude",
			tier: "Max 5x",
			windows: [{ id: "weekly_all", span: "week", usedPercent: 55, resetsAt: 1_795_381_200_000 }],
			readAt: 1_795_000_000_000,
		},
	],
};

describe("plan.usage", () => {
	test("answers the reader's result", async () => {
		const rig = await startCoreRig({ core: { usage: { read: async () => READING } } });
		const phone = await rig.client("phone");
		expect((await phone.ok("plan.usage", {})).result).toEqual(READING);
	});

	test("is unsupported on a bridge that reads no usage", async () => {
		const rig = await startCoreRig();
		const phone = await rig.client("phone");
		const { result } = await phone.ok("plan.usage", {});
		expect(result.status === "rejected" && result.rejection.code).toBe("unsupported");
	});
});
