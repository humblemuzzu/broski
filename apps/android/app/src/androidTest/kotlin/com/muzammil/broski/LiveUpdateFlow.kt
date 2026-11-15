package com.muzammil.broski

import android.app.Notification
import android.app.NotificationManager
import android.service.notification.StatusBarNotification
import com.muzammil.broski.feature.notifications.LiveUpdate
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import uniffi.broski_core.SessionUpdate
import uniffi.broski_core.SessionView

/**
 * A run on the real machine that holds, so it stays working: the Live Update appears with the run
 * it follows, and pressing its Stop ends the run on the Mac and the Live Update with it.
 */
class LiveUpdateFlow(private val ui: WorkspaceUiDriver, private val machine: RealMachine) {
    private val manager = machine.context.getSystemService(NotificationManager::class.java)

    fun run() = runBlocking {
        val session = machine.seed("Live update")
        machine.scriptHold(session)
        val view = machine.prompt(session, "Hold on")
        try {
            val live = waitFor { live() }
            assertEquals("1 agent working", live.notification.extras.getString(Notification.EXTRA_TITLE))
            assertEquals("Pi · Live update · ${machine.phone.machines.value.single().name}", live.notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
            Shots.shade("live-update")
            val stop = live.notification.actions.single { it.title.toString() == ui.string(R.string.live_stop) }
            stop.actionIntent.send()
            waitForRunToEnd(view)
            waitFor { if (live() == null) Unit else null }
        } finally {
            view.detach()
            view.close()
        }
    }

    private fun live(): StatusBarNotification? = manager.activeNotifications.firstOrNull { it.id == LiveUpdate.ID }

    /** The held run is live while the Live Update shows; it ends only by the abort Stop sent. */
    private suspend fun waitForRunToEnd(view: SessionView) = withTimeout(TIMEOUT_MS) {
        while (view.snapshot()?.run != null) {
            if (view.nextUpdate() is SessionUpdate.Ended) error("the view ended before the run")
        }
    }

    private suspend fun <T : Any> waitFor(read: () -> T?): T = withTimeout(TIMEOUT_MS) {
        var value = read()
        while (value == null) {
            delay(POLL_MS)
            value = read()
        }
        value
    }

    private companion object {
        const val TIMEOUT_MS = 30_000L
        const val POLL_MS = 200L
    }
}
