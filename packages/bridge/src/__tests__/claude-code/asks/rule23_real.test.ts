/**
 * Conformance rule 23 for each of the six declared kinds over the ask desk wired into the real `claude` CLI, which the
 * scripted endpoint drives: the CLI raises each ask, a person's answer reaches it through the desk, and Stop cancels it.
 */

import { describe, expect, test } from "bun:test";
import { CatalogRecorder, Rig } from "../../../contract/testing/conformance-harness";
import { declaredInteractionsAnswerCorrectly } from "../../../contract/testing/rules-interactions";
import { expectNoOrphans } from "../spike/rig/orphans";
import { AskRigBackend } from "./rig/ask-backend";
import type { AskCliFactory } from "./rig/cli";
import { AskRigDriver } from "./rig/driver";
import { RealAskCli } from "./rig/real-cli";

expectNoOrphans();

const RULE_MS = 20_000;
const SUITE_MS = 600_000;

describe("rule 23 over the ask desk and the real CLI", () => {
	test(
		"every declared interaction kind is answered, checked and cancelled correctly",
		async () => {
			const made: RealAskCli[] = [];
			const factory: AskCliFactory = () => {
				const cli = new RealAskCli();
				made.push(cli);
				return cli;
			};
			const backend = new AskRigBackend(factory);
			const rig = new Rig(backend, new AskRigDriver(backend, "/tmp"), new CatalogRecorder(RULE_MS), RULE_MS);
			try {
				await declaredInteractionsAnswerCorrectly(rig);
			} finally {
				await backend.dispose();
			}
			expect(made.flatMap((cli) => cli.escapes)).toEqual([]);
		},
		SUITE_MS,
	);
});
