import { createLazyModule } from "./lazy-module";

const piAi = createLazyModule("the Pi AI SDK", () => import("@earendil-works/pi-ai"));
const piAiBunOAuth = createLazyModule("the Pi AI Bun OAuth flows", () => import("@earendil-works/pi-ai/bun-oauth"));

export const loadPiAi = piAi.load;
export const piAiModule = piAi.get;
export const loadPiAiBunOAuth = piAiBunOAuth.load;
export const piAiBunOAuthModule = piAiBunOAuth.get;
