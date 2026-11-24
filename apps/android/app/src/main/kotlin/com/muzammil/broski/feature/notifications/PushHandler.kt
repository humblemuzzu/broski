package com.muzammil.broski.feature.notifications

import android.content.Context
import android.util.Log
import com.muzammil.broski.R
import com.muzammil.broski.core.SessionKey
import com.muzammil.broski.core.SessionMark
import com.muzammil.broski.core.settings.NotificationKind
import com.muzammil.broski.core.MachineName
import com.muzammil.broski.core.vault.Vault
import java.io.IOException
import kotlinx.coroutines.flow.first
import uniffi.broski_core.ClientException
import uniffi.broski_core.MachineRecord
import uniffi.broski_core.openNotification

/**
 * Turns a relay push into a notification: finds the machine's stored record, opens the sealed
 * payload with it (the relay never sees the words), keeps to the person's local choices, and posts.
 * The machine already leaves out what the person turned off, so the choices here only cover a push
 * that was sent before it heard of them. Needs no `Phone` and no network, so it fits in the seconds
 * a data message gets.
 */
class PushHandler(
    private val context: Context,
    private val vault: Vault,
    private val enabled: suspend () -> Set<NotificationKind>,
    private val remoteScreenEnabled: suspend () -> Boolean = { false },
    private val notifier: Notifier = Notifier(context),
    private val visibleSession: () -> SessionTarget? = { null },
    private val nowMs: () -> Long = System::currentTimeMillis,
    private val seen: PushDedup = SharedDedup,
) {
    /** What a push became once opened: its real kind, the notification it concerns, and the alert if it is one. */
    private class Opened(val kind: PushKind, val tag: String, val alert: Alert?, val atMs: Long?)

    /** The alert that was posted, or null when the push was dropped (unknown machine, turned off, muted, stale, duplicate, foreground, unreadable) or took a notification down. */
    suspend fun handle(data: Map<String, String>): Alert? {
        val push = RelayPush.of(data) ?: return dropped("not a relay push: ${data.keys}")
        val records = try {
            vault.records().readable
        } catch (error: IOException) {
            Log.e(TAG, "the stored records could not be read", error)
            emptyMap()
        }
        val record = records[push.machineId] ?: return dropped("no stored record for the machine the push names")
        val opened = try {
            MachineRecord.fromBytes(record).use { open(it, push, namesMachine = records.size > 1) }
        } catch (error: ClientException) {
            Log.w(TAG, "the push does not open with the stored record", error)
            null
        } ?: return null
        if (opened.kind == PushKind.Resolved) {
            notifier.cancel(opened.tag)
            return null
        }
        if (opened.kind == PushKind.MacDialog && !remoteScreenEnabled()) return dropped("remote screen is off")
        if (opened.kind.preference?.let { it !in enabled() } == true) return null
        val alert = opened.alert ?: return null
        if (alert.mutedBy(muted())) return dropped("session is muted")
        if (!seen.record("${alert.tag}:${opened.atMs ?: push.payload.hashCode()}")) return dropped("duplicate push")
        if (opened.kind in FINISHES && opened.atMs != null && nowMs() - opened.atMs > DONE_STALE_MS) {
            return dropped("stale done push")
        }
        if (alert.session != null && alert.session == visibleSession()) {
            return dropped("session is open in foreground")
        }
        notifier.post(alert)
        return alert
    }

    private fun open(stored: MachineRecord, push: RelayPush, namesMachine: Boolean): Opened? {
        if (push.kind == PushKind.Offline) {
            return offline(stored, push)?.let { Opened(PushKind.Offline, it.tag, it, null) }
        }
        val note = openNotification(stored, push.payload)
        val kind = PushKind.of(note.kind) ?: return dropped("a ${note.kind} push is of no kind this app knows")
        val tag = Alert.tag(push.machineId, kind, note)
        val alert = if (kind == PushKind.Resolved) null else Alert.of(push.machineId, kind, note, namesMachine)
        return Opened(kind, tag, alert, note.atMs.toLong())
    }

    private suspend fun muted(): Set<SessionKey> = try {
        vault.marked(SessionMark.Muted).first()
    } catch (error: IOException) {
        Log.e(TAG, "the muted sessions could not be read", error)
        emptySet()
    }

    private fun offline(record: MachineRecord, push: RelayPush): Alert? {
        val alert = OfflineAlert.of(push.payload) ?: return dropped("an offline alert that does not read")
        val name = MachineName.display(record.name())
        return Alert(
            tag = "${push.machineId}/offline",
            channel = Channel.MachineOffline,
            title = context.getString(if (alert.asleep) R.string.notify_machine_asleep else R.string.notify_machine_offline, name),
            text = context.getString(R.string.notify_machine_away_body),
            machineName = null,
            session = null,
            request = null,
        )
    }

    private fun <T> dropped(why: String): T? {
        Log.i(TAG, "push dropped: $why")
        return null
    }

    private companion object {
        const val TAG = "Push"
        const val DONE_STALE_MS = 5L * 60 * 1_000
        val FINISHES = setOf(PushKind.Done, PushKind.Failed)
        val SharedDedup = PushDedup()
    }
}

/** Bounded FIFO set of the last 64 push keys so redelivered FCM messages do not alert twice. */
class PushDedup(private val capacity: Int = 64) {
    private val keys = LinkedHashSet<String>(capacity)

    @Synchronized
    fun record(key: String): Boolean {
        if (!keys.add(key)) return false
        if (keys.size > capacity) {
            val oldest = keys.iterator()
            if (oldest.hasNext()) {
                oldest.next()
                oldest.remove()
            }
        }
        return true
    }
}
