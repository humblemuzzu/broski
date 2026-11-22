package com.muzammil.broski.feature.chat

import androidx.compose.runtime.Immutable
import com.muzammil.broski.core.Agent
import com.muzammil.broski.core.MachineHealth
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.feature.chat.composer.Outgoing
import uniffi.broski_contract.NoticeLevel
import uniffi.broski_contract.RejectionCode
import uniffi.broski_contract.SessionRef
import uniffi.broski_core.ClientException
import uniffi.broski_core.InboxState

/** What the chat's header shows of the session and its machine. */
@Immutable
data class ChatHeader(
    val title: String?,
    val agent: Agent,
    val cwd: String?,
    val machineName: String,
    val health: MachineHealth?,
    /** The Mac is reachable and the view attaches again: what shows is not live yet. */
    val reconnecting: Boolean = false,
    /** Where the inbox lists the session; `null` while it does not. */
    val inboxState: InboxState? = null,
) {
    /** Whether what the chat shows follows the session now. */
    val online: Boolean get() = health?.isOnline != false && !reconnecting

    val folder: String? get() = cwd?.trimEnd('/')?.substringAfterLast('/')?.takeIf { it.isNotEmpty() }

    /** Nothing waits on the person and nothing runs: the session can be left unread. */
    val settled: Boolean get() = inboxState == InboxState.DONE || inboxState == InboxState.IDLE
}

/** A notice or error the agent showed, as a quiet card above the composer until dismissed. */
@Immutable
data class ChatNotice(val id: Long, val level: NoticeLevel, val text: String)

/** Something that happened once, for the screen to say, feel or follow. */
sealed interface ChatEvent {
    /** A request the bridge refused, in its words; [code] says which kind of refusal. */
    data class Refused(val code: RejectionCode, val detail: String) : ChatEvent

    /** A request that did not reach the bridge or got no answer. */
    class Failed(val error: ClientException) : ChatEvent

    data object AnsweredElsewhere : ChatEvent

    data object ImageTooLarge : ChatEvent

    data object NoImageToPaste : ChatEvent

    data object Deleted : ChatEvent

    /** The person marked the session unread: the chat gives way to the inbox. */
    data object LeftUnread : ChatEvent

    data class OpenSession(val session: SessionRef) : ChatEvent
}

/**
 * The first prompt of a session the New session sheet created, handed to the chat that opens it:
 * the bridge takes a prompt only for a viewed session, so the chat sends it once its view is attached.
 */
object FirstPrompts {
    private val waiting = HashMap<Pair<String, SessionRef>, Outgoing>()

    @Synchronized
    fun put(machineId: String, session: SessionRef, outgoing: Outgoing) {
        waiting[machineId to session] = outgoing
    }

    @Synchronized
    fun take(machineId: String, session: SessionRef): Outgoing? = waiting.remove(machineId to session)
}
