import { createLazyModule } from "./lazy-module";

const pi = createLazyModule("the Pi coding agent SDK", () => import("@earendil-works/pi-coding-agent"));

export const loadPiCodingAgent = pi.load;
export const piCodingAgent = pi.get;
