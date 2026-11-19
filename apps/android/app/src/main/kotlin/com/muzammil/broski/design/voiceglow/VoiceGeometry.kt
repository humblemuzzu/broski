package com.muzammil.broski.design.voiceglow

/** The geometry and response knobs a [VoiceGlowType] retunes, in dp. */
internal class VoiceGeometry {
    var scale = 1.0
    var glowSize = 1.0
    var strokeOpacity = 1.0
    var innerOpacity = 1.0
    var bloomOpacity = 1.0
    var idle = 0.18
    var reach = 1.2
    var spread = 1.05
    var flow = 48.0
    var bend = 60.0
    var bandStrength = 1.55
    var bandWidth = 2.15
    var bandPosition = 0.35
    var bandCurve = 1.75
    var bandSpread = 0.87
    var bandSkew = 0.12
    var bandOffset = -27.0
    var bandTail = 0.59
    var bandTailPosition = 0.67
    var bandTailCurve = 2.4
    var bandTailOverflow = 15.0
    var bandAberration = 0.89
    var glowWidth = 0.65
    var glowHeight = 1.25
    var lobeSpacing = 0.85
    var rangeWidth = 0.75
    var rangeHeight = 1.0
    var softness = 1.07
    var coreSize = 1.0
    var coreLight = 0.0
    var coreLightWidth = 1.0
    var coreLightHeight = 1.0
    var strokeScale = 1.0
    var innerScale = 1.0
    var innerHeight = 1.0
    var bloomScale = 1.0
    var bloomHeight = 1.0

    var brightness: Double? = null
    var saturation: Double? = null
    var strength: Double? = null

    /** Multiplies [scale] into every dimension in dp, as the web component does. */
    fun scaled(): VoiceGeometry {
        val sc = maxOf(0.05, scale)
        scale = sc
        flow *= sc
        bend *= sc
        bandWidth *= sc
        bandOffset *= sc
        bandTailOverflow *= sc
        glowWidth *= sc
        glowHeight *= sc
        lobeSpacing *= sc
        rangeWidth *= sc
        rangeHeight *= sc
        coreSize *= sc
        glowSize *= sc
        return this
    }

    companion object {
        /** The type's geometry on a theme, with the type's light-theme overrides applied. */
        fun resolve(type: VoiceGlowType, dark: Boolean): VoiceGeometry = VoiceGeometry().apply {
            when (type) {
                VoiceGlowType.STANDARD -> standard(dark)
                VoiceGlowType.PILL -> pill(dark)
                VoiceGlowType.MOBILE -> mobile(dark)
            }
        }

        private fun VoiceGeometry.standard(dark: Boolean) {
            if (dark) {
                brightness = 1.15
            } else {
                reach = 1.8
                spread = 0.8
                coreLight = 1.8
                bandStrength = 1.7
            }
        }

        private fun VoiceGeometry.pill(dark: Boolean) {
            if (!dark) coreLight = 1.8
            scale = 0.45
            glowSize = 0.95
            strokeOpacity = 1.2
            innerOpacity = 0.85
            reach = 1.35
            spread = 1.1
            flow = 0.0
            bend = 23.0
            bandStrength = if (dark) 1.55 else 2.0
            bandWidth = 1.85
            bandCurve = 1.95
            bandSpread = 0.38
            bandOffset = -16.0
            bandTail = 0.0
            glowWidth = 0.65
            glowHeight = 0.95
            lobeSpacing = 0.45
            rangeWidth = 0.8
            rangeHeight = 0.7
            softness = 0.88
            coreSize = 0.25
            strokeScale = 1.25
            innerScale = 0.95
            bloomScale = 1.05
            bloomHeight = 2.25
            if (dark) {
                brightness = 1.35
                saturation = 1.5
            }
        }

        private fun VoiceGeometry.mobile(dark: Boolean) {
            if (!dark) coreLight = 1.8
            scale = 1.25
            spread = 0.45
            reach = 3.0
            flow = 60.0
            bend = 70.0
            bandWidth = 2.4
            bandCurve = 1.55
            bandSpread = 0.9
            bandOffset = -50.0
            bandTail = 0.62
            bandTailPosition = 0.42
            bandTailCurve = 2.7
            bandTailOverflow = 22.0
            bandStrength = if (dark) 1.8 else 1.7
            glowWidth = 1.15
            glowHeight = 2.1
            lobeSpacing = 1.35
            rangeWidth = 1.25
            rangeHeight = 1.2
            softness = 1.1
            strength = 1.0
            if (dark) {
                brightness = 1.2
                saturation = 1.5
            }
        }
    }
}
