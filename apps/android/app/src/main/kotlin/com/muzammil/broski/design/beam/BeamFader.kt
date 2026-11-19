package com.muzammil.broski.design.beam

/**
 * The beam's fade in and out, evaluated per frame in time (the web's `beam-fade-in` and `beam-fade-out`,
 * CSS `ease`). A change of target starts from wherever the fade has got to, so a beam switched off
 * and on again never jumps.
 */
class BeamFader(private val fadeInSeconds: Double, private val fadeOutSeconds: Double) {
    private var from = 0.0
    private var target = 0.0
    private var start = 0.0
    private var duration = 0.0

    fun value(seconds: Double): Double {
        if (duration <= 0) return target
        val progress = ((seconds - start) / duration).coerceIn(0.0, 1.0)
        return from + (target - from) * cssEase(progress)
    }

    /** Fades towards shown or hidden from [seconds]; nothing happens when it already heads there. */
    fun retarget(shown: Boolean, seconds: Double) {
        val want = if (shown) 1.0 else 0.0
        if (want == target) return
        from = value(seconds)
        target = want
        start = seconds
        duration = if (shown) fadeInSeconds else fadeOutSeconds
    }

    /** True while a fade in or out is still under way. */
    fun isFading(seconds: Double): Boolean = duration > 0 && seconds - start < duration

    /** True once the beam is fully faded out, which is when nothing needs drawing or ticking. */
    fun isHidden(seconds: Double): Boolean = target == 0.0 && value(seconds) <= 0.0

    companion object {
        /** CSS `ease`, `cubic-bezier(0.25, 0.1, 0.25, 1)`. */
        fun cssEase(x: Double): Double = cubicBezier(0.25, 0.1, 0.25, 1.0, x)

        /** y for progress [x] on a CSS cubic-bezier timing curve, solved by bisection as BorderBeamKit does. */
        fun cubicBezier(x1: Double, y1: Double, x2: Double, y2: Double, x: Double): Double {
            if (x <= 0) return 0.0
            if (x >= 1) return 1.0
            var lo = 0.0
            var hi = 1.0
            var t = x
            repeat(12) {
                val mt = 1 - t
                val bx = 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t
                if (bx < x) lo = t else hi = t
                t = (lo + hi) / 2
            }
            val mt = 1 - t
            return 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t
        }
    }
}
