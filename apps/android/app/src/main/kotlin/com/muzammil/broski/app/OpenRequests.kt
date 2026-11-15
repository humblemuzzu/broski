package com.muzammil.broski.app

import android.content.Intent
import com.muzammil.broski.feature.notifications.OpenSession
import com.muzammil.broski.feature.notifications.wire
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import uniffi.broski_contract.BackendId

/**
 * A session to open from outside the app's own navigation (a tapped notification), held until the
 * shell is there to show it: the app may still be starting, or showing the welcome.
 */
class OpenRequests {
    private val pending = MutableStateFlow<SessionRoute?>(null)
    val next: StateFlow<SessionRoute?> = pending.asStateFlow()

    fun offer(intent: Intent?) {
        val target = OpenSession.from(intent) ?: return
        val backend = BackendId.entries.firstOrNull { it.wire == target.backend } ?: return
        pending.value = SessionRoute(target.machineId, backend.name, target.sessionId)
    }

    fun taken(route: SessionRoute) {
        pending.compareAndSet(route, null)
    }
}
