package com.muzammil.broski.feature.notifications

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import com.muzammil.broski.R
import com.muzammil.broski.app.MainActivity
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.displayName
import uniffi.broski_core.InboxState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.withContext

/**
 * The one ongoing notification while any agent works: a promoted Live Update on Android 16 (an
 * indeterminate ProgressStyle the system shows as a chip and on the lock screen), an ordinary
 * ongoing notification below it. It summarises every run, follows the newest one with its elapsed
 * time and a Stop for it, and goes when nothing works.
 *
 * While it shows, [hold] keeps the phone's links up and [LiveUpdateService] keeps the process
 * running in the background, so it stays true with the phone locked. Android lets that service
 * start only while the app is on screen; a run that starts while it is not shows without it.
 */
class LiveUpdate(
    private val context: Context,
    private val phone: PhoneSession,
    private val hold: (Boolean) -> Unit,
) {
    private val notifier = Notifier(context)
    private val manager = NotificationManagerCompat.from(context)

    suspend fun run() {
        manager.cancel(ID)
        val since = mutableMapOf<SessionTarget, Long>()
        combine(phone.inboxRows, phone.machines) { rows, machines ->
            val reachable = machines.filter { it.health.isOnline }.map { it.id }.toSet()
            LiveStatus.of(rows, since, System.currentTimeMillis(), reachable)
        }
            .distinctUntilChanged()
            .conflate()
            .collect { status ->
                if (status == null) end() else show(build(status))
                delay(UPDATE_EVERY_MS)
            }
    }

    @Suppress("MissingPermission")
    private suspend fun show(notification: Notification) {
        if (!notifier.canPost) return
        current = notification
        manager.notify(ID, notification)
        hold(true)
        if (!LiveUpdateService.running) withContext(Dispatchers.Main) { startService() }
    }

    private fun end() {
        current = null
        context.stopService(Intent(context, LiveUpdateService::class.java))
        manager.cancel(ID)
        hold(false)
    }

    private fun startService() {
        if (!ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) return
        try {
            ContextCompat.startForegroundService(context, Intent(context, LiveUpdateService::class.java))
        } catch (error: IllegalStateException) {
            Log.i(TAG, "the Live Update's service could not start; it updates while the app runs", error)
        }
    }

    fun build(status: LiveStatus): Notification {
        val row = status.focused
        val agent = context.getString(row.session.backend.displayName)
        val working = context.resources.getQuantityString(R.plurals.live_working, status.working, status.working)
        val needsYou = context.resources.getQuantityString(R.plurals.live_needs_you, status.needsYou, status.needsYou)
        val header = when {
            status.working > 0 && status.needsYou > 0 -> "$working · $needsYou"
            status.needsYou > 0 -> needsYou
            else -> working
        }
        val session = row.title ?: context.getString(R.string.inbox_untitled)
        val isWorking = row.state == InboxState.WORKING
        val chip = context.getString(if (status.needsYou > 0) R.string.live_chip_needs_you else R.string.live_chip)
        return NotificationCompat.Builder(context, Channel.LiveStatus.id)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(header)
            .setContentText(context.getString(R.string.live_focused, agent, session, row.machineName))
            .setStyle(NotificationCompat.ProgressStyle().setProgressIndeterminate(true))
            .setColorized(false)
            .setRequestPromotedOngoing(true)
            .setShortCriticalText(chip)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(LIVE_TIMEOUT_MS)
            .setWhen(status.sinceMs)
            .setUsesChronometer(isWorking)
            .setShowWhen(isWorking)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setContentIntent(open(status.target))
            .addAction(R.drawable.ic_stop, context.getString(R.string.live_stop), stop(status.target))
            .build()
    }

    private fun open(target: SessionTarget): PendingIntent {
        val intent = OpenSession.put(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), target)
        return PendingIntent.getActivity(context, REQUEST_OPEN, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun stop(target: SessionTarget): PendingIntent {
        val intent = OpenSession.put(Intent(context, StopReceiver::class.java), target)
        return PendingIntent.getBroadcast(context, REQUEST_STOP, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    companion object {
        /** The Live Update's notification id, which its service's foreground notification shares. */
        const val ID = 1_000
        const val TAG = "LiveUpdate"
        private const val UPDATE_EVERY_MS = 2_000L
        private const val LIVE_TIMEOUT_MS = 2L * 60 * 60 * 1_000
        private const val REQUEST_OPEN = 1
        private const val REQUEST_STOP = 2

        /** The notification now showing, for the service to start in the foreground with. */
        @Volatile
        var current: Notification? = null
            private set
    }
}
