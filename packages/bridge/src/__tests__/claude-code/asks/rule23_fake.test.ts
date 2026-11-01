/** Conformance rule 23 for each of the six declared kinds, against the desk driven by a scripted CLI (no process). */

import { describe, test } from "bun:test";
import { CatalogRecorder, Rig } from "../../../contract/testing/conformance-harness";
import { declaredInteractionsAnswerCorrectly } from "../../../contract/testing/rules-interactions";
import { AskRigBackend } from "./rig/ask-backend";
import { AskRigDriver } from "./rig/driver";
import { FakeAskCli } from "./rig/fake-cli";

describe("rule 23 over the ask desk and a scripted CLI", () => {
	test("every declared interaction kind is answered, checked and cancelled correctly", async () => {
		const backend = new AskRigBackend(() => new FakeAskCli());
		const rig = new Rig(backend, new AskRigDriver(backend, "/tmp"), new CatalogRecorder(2_000), 2_000);
		try {
			await declaredInteractionsAnswerCorrectly(rig);
		} finally {
			await backend.dispose();
		}
	});
});
