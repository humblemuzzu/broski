package com.muzammil.broski.feature.notifications

import android.content.Context
import android.util.Log
import com.muzammil.broski.R
import com.muzammil.broski.core.settings.NotificationKind
import com.muzammil.broski.core.vault.Vault
import java.io.IOException
import uniffi.broski_core.ClientException
import uniffi.broski_core.MachineRecord
import uniffi.broski_core.openNotification

/**
 * Turns a relay push into a notification: finds the machine's stored record, opens the sealed
 * payload with it (the relay never sees the words), keeps to the person's local choices, and posts.
 * Needs no `Phone` and no network, so it fits in the seconds a data message gets.
 */
class PushHandler(
    private val context: Context,
    private val vault: Vault,
    private val enabled: suspend () -> Set<NotificationKind>,
    private val notifier: Notifier = Notifier(context),
) {
    /** The alert that was posted, or null when the push was dropped (unknown machine, turned off, unreadable). */
    suspend fun handle(data: Map<String, String>): Alert? {
        val push = RelayPush.of(data) ?: return dropped("not a relay push: ${data.keys}")
        if (push.kind.preference !in enabled()) return null
        val record = try {
            vault.records().readable[push.machineId]
        } catch (error: IOException) {
            Log.e(TAG, "the stored records could not be read", error)
            null
        } ?: return dropped("no stored record for the machine the push names")
        val alert = try {
            MachineRecord.fromBytes(record).use { stored ->
                if (push.kind == PushKind.Offline) offline(stored, push) else Alert.of(push.machineId, push.kind, openNotification(stored, push.payload))
            }
        } catch (error: ClientException) {
            Log.w(TAG, "the push does not open with the stored record", error)
            null
        } ?: return null
        notifier.post(alert)
        return alert
    }

    private fun offline(record: MachineRecord, push: RelayPush): Alert? {
        val alert = OfflineAlert.of(push.payload) ?: return dropped("an offline alert that does not read")
        val name = record.name()
        return Alert(
            tag = "${push.machineId}/offline",
            channel = Channel.MachineOffline,
            title = context.getString(if (alert.asleep) R.string.notify_machine_asleep else R.string.notify_machine_offline, name),
            text = context.getString(R.string.notify_machine_away_body),
            machineName = name,
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
    }
}
