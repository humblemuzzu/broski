package com.muzammil.broski.feature.notifications

import com.muzammil.broski.core.settings.NotificationKind
import java.util.Base64
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * What a push is about, as the relay names it in `k` or the machine's sealed payload names it, the
 * channel it alerts on and the local preference that can silence it. The relay knows a failed run
 * as `done`, so the sealed kind is the one that counts. `Resolved` is no alert: it takes a request's
 * notification down.
 */
enum class PushKind(val wire: String, val preference: NotificationKind?, val channel: Channel?) {
    Approval("approval", NotificationKind.NeedsYou, Channel.NeedsYou),
    Attention("attention", NotificationKind.NeedsYou, Channel.NeedsYou),
    Done("done", NotificationKind.Done, Channel.Done),
    Failed("failed", NotificationKind.Failures, Channel.Failed),
    Resolved("resolved", null, null),
    Offline("offline", NotificationKind.Failures, Channel.MachineOffline),
    ;

    companion object {
        fun of(wire: String?): PushKind? = entries.firstOrNull { it.wire == wire }
    }
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
            val kind = PushKind.of(data["k"]) ?: return null
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
