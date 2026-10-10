import { createLazyModule } from "./lazy-module";

const chordContext = createLazyModule("the chord context module", () => import("@earendil-works/chord/context"));

export const loadChordContext = chordContext.load;
export const chordContextModule = chordContext.get;
