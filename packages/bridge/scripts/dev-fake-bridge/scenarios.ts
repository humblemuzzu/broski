import { sampleRequest } from "../../src/contract/testing/fake-scenarios";
import type { FakeStep } from "../../src/contract/testing/fake-script";

export const FAKE_SCENARIOS = ["ask", "hold"] as const;
export type FakeScenarioName = (typeof FAKE_SCENARIOS)[number];

/**
 * What the fake's next run of a session does, by name: `ask` stops on a choice until a phone answers
 * it; `hold` streams, waits for `release`, and streams again.
 */
export function fakeScenario(name: FakeScenarioName): FakeStep[] {
	switch (name) {
		case "ask":
			return [
				{ kind: "ask", title: "Pick one", request: sampleRequest("choice") },
				{ kind: "text", text: "Thanks." },
			];
		case "hold":
			return [{ kind: "text", text: "Working." }, { kind: "hold" }, { kind: "text", text: "Done holding." }];
	}
}
