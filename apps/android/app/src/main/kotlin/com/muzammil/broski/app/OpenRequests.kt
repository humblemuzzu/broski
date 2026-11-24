package com.muzammil.broski.app

import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.staticCompositionLocalOf
import com.muzammil.broski.core.BackendIds
import com.muzammil.broski.feature.notifications.OpenScreen
import com.muzammil.broski.feature.notifications.OpenSession
import com.muzammil.broski.feature.usage.widget.UsageWidgetProvider
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A destination to open from outside the app's own navigation (a tapped notification, a Home Screen
 * widget, a `broski://` link), held until the shell is there to show it. A pairing link is held apart:
 * the welcome takes it before anything is paired, the shell's Pair screen after.
 */
class OpenRequests {
    private val pending = MutableStateFlow<Route?>(null)
    val next: StateFlow<Route?> = pending.asStateFlow()

    private val pendingPair = MutableStateFlow<String?>(null)

    /** A `broski://pair` link opened from outside, until a pairing screen takes it. */
    val pairLink: StateFlow<String?> = pendingPair.asStateFlow()

    fun offer(intent: Intent?) {
        val uri = intent?.data
        if (intent?.action == Intent.ACTION_VIEW && uri?.scheme == SCHEME) {
            offerLink(uri)
            return
        }
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

    /** `broski://pair?…`, `broski://usage`, `broski://session?machine=…&backend=…&session=…`, as iOS opens them. */
    private fun offerLink(uri: Uri) {
        when (uri.host) {
            "pair" -> pendingPair.value = uri.toString()
            "usage" -> pending.value = UsageRoute
            "session" -> {
                val machine = uri.getQueryParameter("machine") ?: return
                val backend = uri.getQueryParameter("backend")?.takeIf(BackendIds::isValid) ?: return
                val session = uri.getQueryParameter("session") ?: return
                pending.value = SessionRoute(machine, backend, session)
            }
        }
    }

    fun taken(route: Route) {
        pending.compareAndSet(route, null)
    }

    /** The pairing link, once: the screen that takes it shows its offer. */
    fun takePairLink(): String? {
        val link = pendingPair.value ?: return null
        return if (pendingPair.compareAndSet(link, null)) link else null
    }

    private companion object {
        const val SCHEME = "broski"
    }
}

val LocalOpenRequests = staticCompositionLocalOf<OpenRequests?> { null }
