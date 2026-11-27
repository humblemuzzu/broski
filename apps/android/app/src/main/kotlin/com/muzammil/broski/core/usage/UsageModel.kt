package com.muzammil.broski.core.usage

import android.content.Context
import android.util.Log
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.feature.usage.widget.UsageWidgetProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import uniffi.broski_contract.ClientMessage
import uniffi.broski_contract.PlanUsageRequest
import uniffi.broski_contract.PlanUsageResult
import uniffi.broski_contract.ServerMessage
import uniffi.broski_core.ClientException
import uniffi.broski_core.Machine

/**
 * Reads `plan.usage` from every connected Mac (at most once a minute unless forced), merges plans
 * across Macs keeping the newest reading per plan, persists to [UsageStore], and refreshes the
 * Home Screen widgets whenever the report changes. A Mac that does not answer changes nothing; one
 * that answers with no meters clears the plans it no longer meters.
 */
class UsageModel(
    private val context: Context,
    private val store: UsageStore = UsageStore(context),
    private val onPublished: () -> Unit = { UsageWidgetProvider.updateAll(context) },
) {
    private val mutableReport = MutableStateFlow(store.load())
    val report: StateFlow<UsageReport?> = mutableReport.asStateFlow()

    private val mutableReading = MutableStateFlow(false)
    val isReading: StateFlow<Boolean> = mutableReading.asStateFlow()

    private val lock = Mutex()
    private var lastReadMs: Long = 0L

    suspend fun refresh(phone: PhoneSession, force: Boolean = false) {
        if (!lock.tryLock()) return
        try {
            val now = System.currentTimeMillis()
            if (!force && lastReadMs > 0L && now - lastReadMs < MINIMUM_GAP_MS) return
            val ready = phone.machines.value.filter { it.health.isOnline }
            if (ready.isEmpty()) return
            mutableReading.value = true
            lastReadMs = now
            val collected = mutableListOf<PlanReport>()
            var answered = false
            for (state in ready) {
                val machine = phone.machine(state.id) ?: continue
                val plans = readFrom(machine, state.name) ?: continue
                answered = true
                collected += plans
            }
            if (!answered) return
            val merged = UsageReport.merged(collected)
            if (merged == mutableReport.value?.plans) return
            val next = UsageReport(plans = merged, savedAtMs = System.currentTimeMillis())
            mutableReport.value = next
            withContext(Dispatchers.IO) { store.save(next) }
            onPublished()
        } finally {
            mutableReading.value = false
            lock.unlock()
        }
    }

    private suspend fun readFrom(machine: Machine, machineName: String): List<PlanReport>? = try {
        val answer = machine.request(ClientMessage.PlanUsage(PlanUsageRequest("")))
        val response = (answer as? ServerMessage.PlanUsageResult)?.v1 ?: return null
        when (val result = response.result) {
            is PlanUsageResult.Accepted -> result.v1.meters.map { PlanReport.from(it, machineName) }
            is PlanUsageResult.Rejected -> {
                Log.i(TAG, "$machineName read no plan usage: ${result.v1.rejection.message}")
                null
            }
        }
    } catch (error: ClientException) {
        Log.w(TAG, "plan usage was not read from $machineName", error)
        null
    }

    companion object {
        private const val TAG = "UsageModel"
        const val MINIMUM_GAP_MS = 60_000L
    }
}
