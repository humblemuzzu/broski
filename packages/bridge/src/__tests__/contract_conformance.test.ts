import { NO_METHODS } from "../contract/testing/fake-backend";
import { fakeConformanceFactory } from "../contract/testing/fake-conformance";
import { MINIMAL_TRAITS } from "../contract/testing/fake-data";
import { runConformance } from "../contract/testing/run-conformance";

runConformance("the fake backend with every capability", fakeConformanceFactory());

runConformance(
	"the fake backend with nothing optional",
	fakeConformanceFactory({ id: "claude-code", traits: MINIMAL_TRAITS, methods: NO_METHODS, modes: [] }),
);

runConformance("the fake backend whose runs outlive the bridge", fakeConformanceFactory({ runsSurviveRestart: true }));
