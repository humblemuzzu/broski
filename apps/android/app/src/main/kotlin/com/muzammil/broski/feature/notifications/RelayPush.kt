package com.muzammil.broski.feature.notifications

import com.muzammil.broski.core.settings.NotificationKind
import java.util.Base64
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** What a push is about, as the relay names it in `k`, and the local preference that can silence it. */
enum class PushKind(val wire: String, val preference: NotificationKind) {
    Approval("approval", NotificationKind.NeedsYou),
    Attention("attention", NotificationKind.NeedsYou),
    Done("done", NotificationKind.Done),
    Offline("offline", NotificationKind.Failures),
}

/**
 * The data of the relay's FCM message (`relay/src/push/fcm.rs`): `m` the machine id, `k` the kind,
 * `e` the payload in b64url — sealed by the machine for every kind but `offline`, which the relay
 * writes itself.
 */
data class RelayPush(val machineId: String, val kind: PushKind, val payload: String) {
    companion object {
        fun of(data: Map<String, String>): RelayPush? {
            val machine = data["m"] ?: return null
            val kind = PushKind.entries.firstOrNull { it.wire == data["k"] } ?: return null
            val payload = data["e"] ?: return null
            return RelayPush(machine, kind, payload)
        }
    }
}

/** The relay's own alert that a machine went away (`relay/src/alerts.rs`): `asleep` or `offline`. */
@Serializable
data class OfflineAlert(val machine: String, val state: String, val since: Long) {
    val asleep: Boolean get() = state == "asleep"

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        /** Null for anything but the relay's alert; a bad b64url and bad JSON are both an IllegalArgumentException. */
        fun of(payload: String): OfflineAlert? = try {
            json.decodeFromString(serializer(), String(Base64.getUrlDecoder().decode(payload)))
        } catch (_: IllegalArgumentException) {
            null
        }
    }
}
