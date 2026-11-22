package com.muzammil.broski.core.usage

import com.muzammil.broski.core.titled
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import uniffi.broski_contract.PlanMeter
import uniffi.broski_contract.UsageSpan
import uniffi.broski_contract.UsageWindow
import kotlin.math.roundToLong

/** The plans the app has its own look for, by their wire ids; any other is drawn in the theme's colours. */
object PlanIds {
    const val CLAUDE = "claude"
    const val ANTIGRAVITY = "antigravity"

    private val known = listOf(CLAUDE, ANTIGRAVITY)

    internal fun rank(plan: String): Int = known.indexOf(plan).takeIf { it >= 0 } ?: known.size
}

/** A plan's wire id, reading too the enum names (`Claude`, `Antigravity`) builds that knew only those stored. */
internal object PlanIdSerializer : KSerializer<String> {
    override val descriptor = PrimitiveSerialDescriptor("com.muzammil.broski.core.usage.PlanId", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: String) = encoder.encodeString(value)

    override fun deserialize(decoder: Decoder): String = when (val stored = decoder.decodeString()) {
        "Claude" -> PlanIds.CLAUDE
        "Antigravity" -> PlanIds.ANTIGRAVITY
        else -> stored
    }
}

@Serializable
enum class LimitSpan(val durationMs: Long, val title: String, val shortTitle: String) {
    FiveHour(5L * 3_600_000L, "5-hour", "5h"),
    Week(7L * 24L * 3_600_000L, "Weekly", "Week");

    companion object {
        fun from(span: UsageSpan): LimitSpan = when (span) {
            UsageSpan.FIVE_HOUR -> FiveHour
            UsageSpan.WEEK -> Week
        }
    }
}

@Serializable
data class UsagePoint(val atMs: Long, val usedPercent: Double)

sealed interface UsagePace {
    data object Under : UsagePace
    data object Steady : UsagePace
    data object Over : UsagePace
    data class RunsOut(val atMs: Long) : UsagePace
}

@Serializable
data class LimitWindow(
    val id: String,
    val span: LimitSpan,
    val scope: String? = null,
    val usedPercent: Double,
    val resetsAtMs: Long? = null,
    val history: List<UsagePoint> = emptyList(),
) {
    val startMs: Long? get() = resetsAtMs?.minus(span.durationMs)

    val shortScope: String? get() = scope?.replace(" and ", " + ")

    val label: String get() = scope?.let { "${span.title} · $it" } ?: span.title

    /** Used fraction 0..1; resets to 0 once `resetsAtMs` has passed. */
    fun used(nowMs: Long): Double {
        if (resetsAtMs != null && resetsAtMs <= nowMs) return 0.0
        return (usedPercent / 100.0).coerceIn(0.0, 1.0)
    }

    /** Elapsed fraction 0..1 through the current window; `null` if unknown or past reset. */
    fun elapsed(nowMs: Long): Double? {
        val reset = resetsAtMs ?: return null
        if (reset <= nowMs) return null
        return (1.0 - (reset - nowMs).toDouble() / span.durationMs.toDouble()).coerceIn(0.0, 1.0)
    }

    /** Projected exhaustion timestamp if current pace runs out before reset; `null` otherwise. */
    fun runsOutMs(nowMs: Long): Long? {
        val reset = resetsAtMs ?: return null
        val elapsed = elapsed(nowMs) ?: return null
        val used = used(nowMs)
        if (used < 0.05 || used >= 1.0 || elapsed < 0.05) return null
        val ratePerMs = used / (elapsed * span.durationMs.toDouble())
        val outMs = nowMs + ((1.0 - used) / ratePerMs).roundToLong()
        return outMs.takeIf { it < reset }
    }

    fun pace(nowMs: Long): UsagePace? {
        val elapsed = elapsed(nowMs) ?: return null
        if (elapsed < 0.05) return null
        runsOutMs(nowMs)?.let { return UsagePace.RunsOut(it) }
        val ahead = used(nowMs) - elapsed
        return when {
            ahead > 0.05 -> UsagePace.Over
            ahead < -0.05 -> UsagePace.Under
            else -> UsagePace.Steady
        }
    }

    companion object {
        fun from(window: UsageWindow): LimitWindow = LimitWindow(
            id = window.id,
            span = LimitSpan.from(window.span),
            scope = window.scope,
            usedPercent = window.usedPercent,
            resetsAtMs = window.resetsAt,
            history = window.history.orEmpty().map { UsagePoint(it.at, it.usedPercent) },
        )
    }
}

@Serializable
data class PlanReport(
    @Serializable(with = PlanIdSerializer::class) val plan: String,
    val displayName: String? = null,
    val tier: String? = null,
    val windows: List<LimitWindow>,
    val readAtMs: Long? = null,
    val problem: String? = null,
    val machineName: String,
) {
    val name: String get() = displayName ?: titled(plan)

    /** Fullest window, preferring Weekly on a tie. */
    fun headline(nowMs: Long): LimitWindow? = windows.maxWithOrNull { a, b ->
        val diff = a.used(nowMs).compareTo(b.used(nowMs))
        if (diff != 0) diff else when {
            a.span == LimitSpan.Week && b.span == LimitSpan.FiveHour -> 1
            a.span == LimitSpan.FiveHour && b.span == LimitSpan.Week -> -1
            else -> 0
        }
    }

    /** Its limits as they read best: each scope in the order the plan gives them, the whole plan first, its five-hour limit before its week. */
    val orderedWindows: List<LimitWindow>
        get() {
            val scopes = (listOf<String?>(null) + windows.map { it.scope }).distinct()
            return windows.sortedWith(compareBy<LimitWindow> { scopes.indexOf(it.scope) }.thenBy { it.span != LimitSpan.FiveHour })
        }

    fun isStale(nowMs: Long): Boolean {
        val read = readAtMs ?: return true
        return nowMs - read > STALE_MS
    }

    companion object {
        private const val STALE_MS = 2L * 3_600_000L

        fun from(meter: PlanMeter, machineName: String): PlanReport = PlanReport(
            plan = meter.plan,
            displayName = meter.displayName,
            tier = meter.tier,
            windows = meter.windows.map(LimitWindow::from),
            readAtMs = meter.readAt,
            problem = meter.problem,
            machineName = machineName,
        )
    }
}

@Serializable
data class UsageReport(
    val plans: List<PlanReport>,
    val savedAtMs: Long,
) {
    companion object {
        /** One report per plan: when multiple Macs read the same plan, keep the newer reading. Claude, Antigravity, then the rest by id. */
        fun merged(plans: List<PlanReport>): List<PlanReport> = plans
            .groupBy { it.plan }
            .values
            .map { readings -> readings.maxBy { it.readAtMs ?: Long.MIN_VALUE } }
            .sortedWith(compareBy<PlanReport> { PlanIds.rank(it.plan) }.thenBy { it.plan })
    }
}
