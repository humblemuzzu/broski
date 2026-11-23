package com.muzammil.broski.app

import android.content.Intent
import com.muzammil.broski.feature.notifications.OpenScreen
import com.muzammil.broski.feature.notifications.OpenSession
import com.muzammil.broski.feature.usage.widget.UsageWidgetProvider
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A destination to open from outside the app's own navigation (a tapped notification or Home Screen
 * widget), held until the shell is there to show it.
 */
class OpenRequests {
    private val pending = MutableStateFlow<Route?>(null)
    val next: StateFlow<Route?> = pending.asStateFlow()

    fun offer(intent: Intent?) {
        if (intent?.getBooleanExtra(UsageWidgetProvider.EXTRA_OPEN_USAGE, false) == true) {
            pending.value = UsageRoute
            return
        }
        OpenScreen.from(intent)?.let { machineId ->
            pending.value = ScreenRoute(machineId)
            return
        }
        val target = OpenSession.from(intent) ?: return
        pending.value = SessionRoute(target.machineId, target.backend, target.sessionId)
    }

    fun taken(route: Route) {
        pending.compareAndSet(route, null)
    }
}
