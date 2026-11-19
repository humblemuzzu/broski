package com.muzammil.broski.design.beam

/** The rotate family's two sizes; the keys are the ones `beam-spec.json` files its presets under. */
enum class BeamSize(val key: String) {
    SM("sm"),
    MD("md"),
}

enum class BeamColorVariant(val key: String) {
    COLORFUL("colorful"),
    MONO("mono"),
    OCEAN("ocean"),
    SUNSET("sunset"),
}

enum class BeamTheme {
    /** Follows the app's theme: dark when the Material surface is dark. */
    AUTO,
    DARK,
    LIGHT,
}
