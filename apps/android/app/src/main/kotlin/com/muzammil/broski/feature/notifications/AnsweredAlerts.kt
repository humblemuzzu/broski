package com.muzammil.broski.feature.notifications

import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.isOnline
import kotlinx.coroutines.flow.combine
import uniffi.broski_core.InboxState

/**
 * Takes an approval or question off the shade once its session stops waiting on the person, whether
 * they answered in the app or on the Mac. Only sessions the phone has just read from a reachable Mac
 * count: a stale row never clears an alert.
 */
class AnsweredAlerts(private val phone: PhoneSession, private val notifier: Notifier) {
    suspend fun run() {
        combine(phone.inboxRows, phone.machines) { rows, machines ->
            val reachable = machines.filter { it.health.isOnline }.map { it.id }.toSet()
            rows.filter { !it.cached && it.machineId in reachable }
        }.collect { known ->
            notifier.cancelAnswered(
                waiting = known.filter { it.state == InboxState.NEEDS_YOU }.map { it.target }.toSet(),
                known = known.map { it.target }.toSet(),
            )
        }
    }
}
