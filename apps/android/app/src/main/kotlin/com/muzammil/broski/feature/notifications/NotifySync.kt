package com.muzammil.broski.feature.notifications

import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.SessionKey
import com.muzammil.broski.core.settings.AppSettings
import com.muzammil.broski.core.settings.NotificationKind
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filterNotNull
import uniffi.broski_core.MutedSession
import uniffi.broski_core.NotifyPrefs

/**
 * Tells every paired machine what this phone wants pushed and which of its sessions are muted, at
 * start, when a choice changes, and for each machine paired later. The machine keeps it and sends
 * only that, so a switch holds with the app closed; the link session repeats it at every connect.
 */
class NotifySync(private val phone: PhoneSession, private val settings: Flow<AppSettings?>) {
    suspend fun run() {
        combine(settings.filterNotNull(), phone.muted, phone.machines) { settings, muted, machines ->
            machines.forEach { machine ->
                phone.machine(machine.id)?.setNotifyPrefs(prefs(settings.notifications, muted, machine.id))
            }
        }.collect {}
    }

    private fun prefs(kinds: Set<NotificationKind>, muted: Set<SessionKey>, machineId: String) = NotifyPrefs(
        needsYou = NotificationKind.NeedsYou in kinds,
        done = NotificationKind.Done in kinds,
        failures = NotificationKind.Failures in kinds,
        muted = muted.filter { it.machineId == machineId }.map { MutedSession(it.backend, it.sessionId) },
    )
}
