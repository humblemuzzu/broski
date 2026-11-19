package com.muzammil.broski.design.voiceglow

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The voice driver, ported from the web `voiceDriver.ts` through VoiceGlowKit's Swift engine: shapes
 * the raw level (noise gate, soft saturation), follows it with an attack/release envelope, advances
 * the flow, folds in the idle breathing and the hue drift. Pure: no Android types.
 */
internal class VoiceGlowEngine {
    private var level = 0.0
    private val bands = DoubleArray(3)
    private val rawBands = DoubleArray(3)
    private var phase = 0.0
    private var t = 0.0
    private var lastTime = 0.0
    private var hasLastTime = false
    private var presence = 0.0
    private val matrixScratch = DoubleArray(18)

    val frame = VoiceGlowFrame()

    /** True while the effect is visible or fading; the host stops drawing below this. */
    val isVisible: Boolean get() = presence > VISIBLE

    /** True while the presence still moves toward [active]: a finite fade rather than the glow's endless life. */
    fun isFading(active: Boolean): Boolean = if (active) presence < 1.0 else presence > 0.0

    /** Forgets the clock, so the first step after a pause advances by one 60 Hz frame, not by the gap. */
    fun restartClock() {
        hasLastTime = false
    }

    /**
     * Advances to [time] (seconds) with the caller's [rawLevel] (0…1) for a host of [width] × [height]
     * dp, and returns the engine's own [frame], rewritten.
     */
    fun step(
        time: Double,
        rawLevel: Double,
        active: Boolean,
        config: VoiceGlowConfig,
        width: Double,
        height: Double,
        motion: VoiceGlowMotion = VoiceGlowMotion.Rest,
    ): VoiceGlowFrame {
        val dt = if (hasLastTime) min(0.05, max(0.0, time - lastTime)) else 1.0 / 60
        lastTime = time
        hasLastTime = true
        t += dt
        presence = if (active) min(1.0, presence + dt / FADE_IN) else max(0.0, presence - dt / FADE_OUT)
        followLevel(rawLevel, dt)

        val g = config.g
        val span = VoiceGlowStyle.LOBE_SPAN * g.lobeSpacing
        val morph = motion.gather
        val cx = if (config.reducedMotion) 0.0 else motion.offset * span / 2
        val gather = 1 - morph * 0.6
        val passWidth = 1 + morph * 0.3 * motion.stretch

        val breathe = if (config.reducedMotion) 0.5 else 0.5 + 0.5 * sin(2 * PI * t / max(0.2, VoiceGlowConfig.BREATHE_DURATION))
        val voiced = level + (1 - level) * config.idle * breathe
        val heldT = max(0.0, min(1.0, (morph - 0.25) / 0.75))
        val held = heldT * heldT * (3 - 2 * heldT)
        val eff = max(voiced, motion.heldLevel * held)

        val f = frame
        f.level = level
        f.presence = presence * presence * (3 - 2 * presence)
        f.glow = 0.15 + 0.85 * eff
        f.h = 0.5 + g.reach * eff
        f.w = (0.85 + g.spread * eff) * passWidth
        f.cx = cx
        f.maskWidth = 1 - morph * 0.45
        f.morph = morph

        if (g.flow != 0.0 && !config.reducedMotion) {
            phase = ((phase + g.flow * eff * dt) % span + span) % span
        }
        val bend = max(0.0, g.bend)
        f.lift = bend * eff
        f.bendA = if (bend > 0) min(1.0, f.lift / bend) else 0.0

        placeLobes(config, motion, width, height, span, gather)
        applyHueDrift(config)
        return f
    }

    private fun followLevel(rawLevel: Double, dt: Double) {
        val raw = min(max(rawLevel, 0.0), 1.0)
        rawBands[0] = raw
        rawBands[1] = raw * (0.72 + 0.28 * sin(t * 9.1))
        rawBands[2] = raw * (0.6 + 0.4 * sin(t * 13.7 + 2))
        level = follow(level, shape(raw, VoiceGlowConfig.THRESHOLD), dt, VoiceGlowConfig.ATTACK, VoiceGlowConfig.RELEASE)
        for (b in 0 until 3) {
            val target = shape(rawBands[b], VoiceGlowConfig.THRESHOLD * 0.6)
            bands[b] = follow(bands[b], target, dt, VoiceGlowConfig.ATTACK, VoiceGlowConfig.RELEASE * 1.15)
        }
    }

    private fun placeLobes(config: VoiceGlowConfig, motion: VoiceGlowMotion, cw: Double, ch: Double, span: Double, gather: Double) {
        val f = frame
        val g = config.g
        val arcRadius = paintedRadius(config.cornerRadius, cw, ch)
        val cornerBlend = f.morph * motion.cornerFollow
        val lobeReach = 30 * g.scale * f.w
        val beamAbsX = cw / 2 + f.cx * f.w
        f.cy = -cornerLift(beamAbsX, cw, arcRadius, lobeReach * 1.4) * cornerBlend
        for (i in 0 until VoiceGlowStyle.LOBE_COUNT) {
            val lobe = VoiceGlowStyle.lobes[i]
            val x = wrapX(lobe.x * g.lobeSpacing + phase, span)
            f.lobeX[i] = x * gather
            f.lobeL[i] = (0.6 + 0.7 * bands[lobe.band]) * edgeEnvelope(x, span)
            val lobeAbsX = cw / 2 + (f.cx + x * gather) * f.w
            f.lobeY[i] = -cornerLift(lobeAbsX, cw, arcRadius, lobeReach) * cornerBlend
        }
    }

    private fun applyHueDrift(config: VoiceGlowConfig) {
        val f = frame
        val hueRange = config.hueRange
        val hue = if (config.staticColors || config.reducedMotion || hueRange == 0.0) {
            0.0
        } else {
            -hueRange + 2 * hueRange * pingPong(t / config.hueDuration)
        }
        VoiceColorMatrix.compose(f.colorMatrix, matrixScratch, config.theme.hueBase + hue, config.brightness, config.saturation)
        for (i in 0 until VoiceGlowStyle.LOBE_COUNT) {
            VoiceColorMatrix.apply(f.colorMatrix, config.baseColors[i % config.baseColors.size], f.colors, i * 3)
        }
    }

    companion object {
        private const val VISIBLE = 0.002
        private const val FADE_IN = 0.6
        private const val FADE_OUT = 0.5

        /** Noise gate then soft saturation, so a shout rounds off instead of clipping. */
        fun shape(raw: Double, threshold: Double): Double {
            if (raw <= threshold) return 0.0
            val t = (raw - threshold) / max(0.001, 1 - threshold)
            return min(1.0, max(0.0, (1 - exp(-3 * t)) / (1 - exp(-3.0))))
        }

        /** One-pole follower: fast up (attack), slow down (release). */
        fun follow(prev: Double, target: Double, dt: Double, attack: Double, release: Double): Double {
            val tau = if (target > prev) attack else release
            val a = 1 - exp(-dt / max(0.001, tau))
            return prev + (target - prev) * a
        }

        /** Wraps a lobe offset into [-span/2, span/2). */
        fun wrapX(x: Double, span: Double): Double {
            val half = span / 2
            val m = (x + half) % span
            return (if (m < 0) m + span else m) - half
        }

        /** Full at the centre, gone at the wrap edge so a lobe never pops sides. */
        fun edgeEnvelope(x: Double, span: Double): Double {
            val t = x / (span / 2 + 4)
            return max(0.0, 1 - t * t)
        }

        fun pingPong(phase: Double): Double = (1 - cos(2 * PI * phase)) / 2

        /** The radius the host actually paints (clamped to half its box). */
        fun paintedRadius(radius: Double, cw: Double, ch: Double): Double = max(0.0, min(radius, min(cw / 2, ch / 2)))

        /** How far above the bottom edge the outline sits at [x]. */
        fun cornerLift(x: Double, cw: Double, radius: Double, influence: Double = 0.0): Double {
            if (radius <= 0) return 0.0
            val d = min(x, cw - x) - influence
            if (d >= radius) return 0.0
            if (d <= 0) return radius
            val dx = radius - d
            return radius - sqrt(max(0.0, radius * radius - dx * dx))
        }
    }
}
