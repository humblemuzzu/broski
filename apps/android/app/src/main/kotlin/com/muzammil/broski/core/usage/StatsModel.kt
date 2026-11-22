package com.muzammil.broski.core.usage

import android.util.Log
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.isOnline
import java.util.TimeZone
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import uniffi.broski_contract.ClientMessage
import uniffi.broski_contract.ServerMessage
import uniffi.broski_contract.StatsHarness
import uniffi.broski_contract.StatsRange
import uniffi.broski_contract.StatsScanState
import uniffi.broski_contract.StatsSummary
import uniffi.broski_contract.StatsSummaryRequest
import uniffi.broski_contract.StatsSummaryResult
import uniffi.broski_core.ClientException
import uniffi.broski_core.Machine
import uniffi.broski_core.mergeStatsSummaries

enum class StatsMetric {
    COST,
    TOKENS,
}

/**
 * Fetches `stats.summary` from every connected Mac and merges them through `mergeStatsSummaries`.
 */
class StatsModel {
    private val mutableSummary = MutableStateFlow<StatsSummary?>(null)
    val summary: StateFlow<StatsSummary?> = mutableSummary.asStateFlow()

    private val mutableReading = MutableStateFlow(false)
    val isReading: StateFlow<Boolean> = mutableReading.asStateFlow()

    private val mutableRange = MutableStateFlow(StatsRange.MONTH)
    val range: StateFlow<StatsRange> = mutableRange.asStateFlow()

    private val mutableMetric = MutableStateFlow(StatsMetric.COST)
    val metric: StateFlow<StatsMetric> = mutableMetric.asStateFlow()

    private val mutableHarness = MutableStateFlow<StatsHarness?>(null)
    val selectedHarness: StateFlow<StatsHarness?> = mutableHarness.asStateFlow()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()
    private var lastKey: String? = null
    private var lastReadMs: Long = 0L
    private var pollJob: Job? = null
    @Volatile private var needsReload = false
    @Volatile private var pendingForce = false

    fun setMetric(next: StatsMetric) {
        mutableMetric.value = next
    }

    suspend fun selectRange(next: StatsRange, phone: PhoneSession) {
        if (mutableRange.value == next) return
        mutableRange.value = next
        refresh(phone, force = true)
    }

    suspend fun toggleHarness(harness: StatsHarness, phone: PhoneSession) {
        mutableHarness.value = if (mutableHarness.value == harness) null else harness
        refresh(phone, force = true)
    }

    suspend fun clearHarness(phone: PhoneSession) {
        if (mutableHarness.value == null) return
        mutableHarness.value = null
        refresh(phone, force = true)
    }

    suspend fun refresh(phone: PhoneSession, force: Boolean = false) {
        if (!lock.tryLock()) {
            needsReload = true
            if (force) pendingForce = true
            return
        }
        try {
            var requestForce = force
            do {
                needsReload = false
                pendingForce = false
                val activeRange = mutableRange.value
                val activeHarness = mutableHarness.value
                val key = "${activeRange.name}|${activeHarness?.name ?: "all"}"
                val now = System.currentTimeMillis()
                if (!requestForce && key == lastKey && lastReadMs > 0L && now - lastReadMs < MINIMUM_GAP_MS) {
                    break
                }
                val ready = phone.machines.value.filter { it.health.isOnline }
                if (ready.isEmpty()) break

                mutableReading.value = true
                val tz = TimeZone.getDefault().id
                val answers = mutableListOf<StatsSummary>()
                for (state in ready) {
                    val machine = phone.machine(state.id) ?: continue
                    val item = readFrom(machine, state.name, activeRange, activeHarness, tz, requestForce)
                    if (item != null) answers += item
                }
                if (mutableRange.value == activeRange && mutableHarness.value == activeHarness && answers.isNotEmpty()) {
                    mergeStatsSummaries(answers)?.let { merged ->
                        mutableSummary.value = merged
                        lastKey = key
                        lastReadMs = System.currentTimeMillis()
                        scheduleFollowUpIfScanning(merged, phone)
                    }
                }
                requestForce = pendingForce
            } while (needsReload)
        } finally {
            mutableReading.value = false
            lock.unlock()
        }
    }

    private fun scheduleFollowUpIfScanning(current: StatsSummary, phone: PhoneSession) {
        pollJob?.cancel()
        if (current.scanState == StatsScanState.FRESH) return
        pollJob = scope.launch {
            delay(2_000L)
            lastReadMs = 0L
            refresh(phone, force = false)
        }
    }

    private suspend fun readFrom(
        machine: Machine,
        machineName: String,
        range: StatsRange,
        harness: StatsHarness?,
        timeZone: String,
        force: Boolean,
    ): StatsSummary? = try {
        val req = StatsSummaryRequest(
            requestId = "",
            range = range,
            harness = harness,
            timeZone = timeZone,
            refresh = if (force) true else null,
        )
        val answer = machine.request(ClientMessage.StatsSummary(req))
        val response = (answer as? ServerMessage.StatsSummaryResult)?.v1 ?: return null
        when (val result = response.result) {
            is StatsSummaryResult.Accepted -> result.v1
            is StatsSummaryResult.Rejected -> {
                Log.i(TAG, "$machineName stats unavailable: ${result.v1.rejection.message}")
                null
            }
        }
    } catch (error: ClientException) {
        Log.w(TAG, "stats request failed for $machineName", error)
        null
    }

    companion object {
        private const val TAG = "StatsModel"
        const val MINIMUM_GAP_MS = 30_000L
    }
}
