import { createLazyModule } from "./lazy-module";

const opencode = createLazyModule("the OpenCode SDK", () => import("@opencode-ai/sdk/v2"));

export const loadOpenCodeSdk = opencode.load;
export const openCodeSdk = opencode.get;
