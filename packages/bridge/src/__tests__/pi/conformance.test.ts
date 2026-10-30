import { afterEach } from "bun:test";
import { runConformance } from "../../contract/testing/run-conformance";
import { piConformanceKit } from "./driver";
import { WAIT_MS } from "./helpers/live-rig";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

const kit = piConformanceKit(WAIT_MS, { link: true });

afterEach(() => kit.dispose());

runConformance("pi", kit.factory, WAIT_MS);
