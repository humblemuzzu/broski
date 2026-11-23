package com.muzammil.broski.feature.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.muzammil.broski.R
import com.muzammil.broski.app.MainActivity

/** Posts the app's notifications on its channels, which it makes first. */
class Notifier(private val context: Context) {
    private val manager = NotificationManagerCompat.from(context)

    init {
        createChannels()
    }

    /** Whether anything posted would show: the permission (Android 13+) and the person's switch for the app. */
    val canPost: Boolean
        get() = manager.areNotificationsEnabled() && (
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            )

    fun post(alert: Alert) {
        if (!canPost) return
        val builder = base(alert).setContentText(alert.text).setStyle(NotificationCompat.BigTextStyle().bigText(alert.text))
        if (alert.request != null && alert.session != null) {
            builder.addAction(decisionAction(alert, Decision.Deny)).addAction(decisionAction(alert, Decision.Allow))
        }
        notify(alert.tag, builder.build())
        notify(SUMMARY_PREFIX + alert.group, summary(alert))
    }

    /** The approval's state after Allow or Deny: being sent, sent, or not sent, with no actions left. */
    fun postDecision(alert: Alert, decision: Decision, state: DecisionState) {
        if (!canPost) return
        val words = context.getString(state.words(decision))
        val notification = base(alert)
            .setContentText(words)
            .setStyle(NotificationCompat.BigTextStyle().bigText("${alert.text}\n$words"))
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(if (state == DecisionState.Sent) SENT_TIMEOUT_MS else 0)
            .build()
        notify(alert.tag, notification)
    }

    fun cancel(tag: String) = manager.cancel(tag, ID)

    private fun base(alert: Alert): NotificationCompat.Builder = NotificationCompat.Builder(context, alert.channel.id)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle(alert.title)
        .setSubText(alert.machineName)
        .setShowWhen(true)
        .setGroup(alert.group)
        .setAutoCancel(true)
        .setCategory(if (alert.channel == Channel.NeedsYou) NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_STATUS)
        .setContentIntent(open(alert))

    private fun summary(alert: Alert) = NotificationCompat.Builder(context, alert.channel.id)
        .setSmallIcon(R.drawable.ic_notification)
        .setSubText(alert.machineName)
        .setGroup(alert.group)
        .setGroupSummary(true)
        .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
        .setAutoCancel(true)
        .setContentIntent(open(alert))
        .build()

    private fun open(alert: Alert): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        alert.session?.let { OpenSession.put(intent, it) }
        alert.screenMachineId?.let { OpenScreen.put(intent, it) }
        return PendingIntent.getActivity(context, alert.tag.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /** Allow needs the phone unlocked, as iOS asks for authentication; Deny does not. */
    private fun decisionAction(alert: Alert, decision: Decision): NotificationCompat.Action {
        val intent = DecisionReceiver.intent(context, alert, decision)
        val pending = PendingIntent.getBroadcast(
            context,
            (alert.tag + decision.name).hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val label = context.getString(if (decision == Decision.Allow) R.string.notify_allow else R.string.notify_deny)
        return NotificationCompat.Action.Builder(null, label, pending)
            .setAuthenticationRequired(decision == Decision.Allow)
            .build()
    }

    @Suppress("MissingPermission")
    private fun notify(tag: String, notification: android.app.Notification) {
        if (canPost) manager.notify(tag, ID, notification)
    }

    private fun createChannels() {
        val channels = listOf(
            NotificationChannel(Channel.NeedsYou.id, context.getString(R.string.channel_needs_you), NotificationManager.IMPORTANCE_HIGH),
            NotificationChannel(Channel.Done.id, context.getString(R.string.channel_done), NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(Channel.MachineOffline.id, context.getString(R.string.channel_offline), NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(Channel.LiveStatus.id, context.getString(R.string.channel_live), NotificationManager.IMPORTANCE_LOW),
        )
        context.getSystemService(NotificationManager::class.java).createNotificationChannels(channels)
    }

    companion object {
        const val ID = 1
        private const val SUMMARY_PREFIX = "group:"
        private const val SENT_TIMEOUT_MS = 8_000L
    }
}
