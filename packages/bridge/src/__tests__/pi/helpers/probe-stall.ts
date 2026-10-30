/** Run by `probe.test.ts`: arms the watchdog with small limits, then starves the event loop with promises. */

import { armWatchdog } from "./memory-watchdog";

armWatchdog({ maxRssMb: 3_072, stallMs: 600 });
const spin = (): void => void Promise.resolve().then(spin);
spin();
