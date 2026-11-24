package com.muzammil.broski.feature.notifications

import com.muzammil.broski.core.MachineName
import com.muzammil.broski.core.SessionKey
import uniffi.broski_core.PushNotification

/** The channels the app posts on, one per kind of news, each turned up or down by the person in Settings. */
enum class Channel(val id: String) {
    NeedsYou("needs_you"),
    Done("done"),
    Failed("failed"),
    MachineOffline("machine_offline"),
    LiveStatus("live_status"),
}

/** A session on a machine, as a notification refers to it: what a tap opens and a decision names. */
data class SessionTarget(val machineId: String, val backend: String, val sessionId: String) {
    val key: SessionKey get() = SessionKey(machineId, backend, sessionId)
}

/**
 * One notification to post, before any words are looked up. A push about a session is tagged by
 * the request it asks about (else the session), so a newer push about the same thing replaces the
 * older; pushes about one session share its group. It shows the time it reached this phone, not the
 * Mac's `at`: the two clocks differ, and Android drops a notification dated over two weeks back.
 */
data class Alert(
    val tag: String,
    val channel: Channel,
    val title: String,
    val text: String,
    /** The Mac's name under the title; `null` while only one Mac is paired, which needs no naming. */
    val machineName: String?,
    val session: SessionTarget?,
    /** The pending request Allow and Deny answer: only for an approval that names one. */
    val request: String?,
    /** Machine to open in Remote Screen when tapping a macOS system-dialog notification. */
    val screenMachineId: String? = null,
) {
    val group: String get() = session?.let { "${it.machineId}/${it.backend}/${it.sessionId}" } ?: tag

    /** About a session the person muted; a machine's own alerts are never muted with its sessions. */
    fun mutedBy(muted: Set<SessionKey>): Boolean = session?.key in muted

    companion object {
        /** The notification a push about `push.request` (else the session's last run) lives in; a failure takes a finish's place. */
        fun tag(machineId: String, kind: PushKind, push: PushNotification): String =
            "$machineId/${push.backend}/${push.session}/${push.request ?: if (kind == PushKind.Failed) PushKind.Done.wire else kind.wire}"

        fun of(machineId: String, kind: PushKind, push: PushNotification, namesMachine: Boolean = true): Alert {
            if (push.kind == "mac_dialog") {
                return Alert(
                    tag = "$machineId/mac_dialog",
                    channel = Channel.NeedsYou,
                    title = push.title,
                    text = push.body,
                    machineName = MachineName.display(push.machine).takeIf { namesMachine },
                    session = null,
                    request = null,
                    screenMachineId = machineId,
                )
            }
            val session = SessionTarget(machineId, push.backend, push.session)
            return Alert(
                tag = tag(machineId, kind, push),
                channel = checkNotNull(kind.channel) { "a ${kind.wire} push is no alert" },
                title = push.title,
                text = push.body,
                machineName = MachineName.display(push.machine).takeIf { namesMachine },
                session = session,
                request = push.request.takeIf { kind == PushKind.Approval },
            )
        }
    }
}
