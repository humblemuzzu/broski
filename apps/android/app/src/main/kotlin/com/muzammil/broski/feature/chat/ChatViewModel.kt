package com.muzammil.broski.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.SessionKey
import com.muzammil.broski.core.agent
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.core.voice.Dictation
import com.muzammil.broski.core.voice.DictationTarget
import com.muzammil.broski.feature.chat.composer.CatalogReader
import com.muzammil.broski.feature.chat.composer.ComposerState
import com.muzammil.broski.feature.chat.composer.ImageAttachments
import com.muzammil.broski.feature.chat.transcript.ChatRow
import com.muzammil.broski.feature.chat.transcript.RowBuilder
import com.muzammil.broski.feature.chat.transcript.RowInput
import com.muzammil.broski.feature.images.ChatImageStore
import com.muzammil.broski.feature.workspace.WorkspaceClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import uniffi.broski_contract.BlockKind
import uniffi.broski_contract.NoticeLevel
import uniffi.broski_contract.SessionGetResult
import uniffi.broski_contract.SessionRef
import uniffi.broski_contract.SessionSummary
import uniffi.broski_contract.TranscriptItem
import uniffi.broski_core.ClientException
import uniffi.broski_core.DictationSources
import uniffi.broski_core.Machine
import uniffi.broski_core.SessionChange
import uniffi.broski_core.ViewEnd

/**
 * One chat: the session's live view and transcript, its catalog for the composer, and the
 * person's actions on it ([ChatActions]). Its loops run in [viewModelScope]; the view ends with it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModel(
    val phone: PhoneSession,
    val machineId: String,
    private val route: SessionRef,
    private val machine: Machine,
    attachments: ImageAttachments,
) : ViewModel() {
    private val mutableSummary = MutableStateFlow<SessionSummary?>(null)
    private val mutableNotices = MutableStateFlow<List<ChatNotice>>(emptyList())
    private val mutableEvents = MutableSharedFlow<ChatEvent>(extraBufferCapacity = 8)
    private var noticeIds = 0L
    private var keepUnread = false

    val workspace = WorkspaceClient(machine::request)
    val feed = SessionFeed(machine, route, viewModelScope, ::moment, ::followed, ::runEnded)
    val composer = ComposerState("", viewModelScope) { phone.saveDraft(machineId, route, it) }
    val catalog = CatalogReader(machine, viewModelScope)
    val actions = ChatActions(this, attachments, mutableEvents)
    val images = ChatImageStore(feed.client, workspace, viewModelScope)

    val events: SharedFlow<ChatEvent> = mutableEvents.asSharedFlow()
    val notices: StateFlow<List<ChatNotice>> = mutableNotices
    val live = feed.live

    val sessionKey: SessionKey get() = SessionKey.of(machineId, feed.session)

    val rows: StateFlow<List<ChatRow>> = RowBuilder().let { builder ->
        combine(feed.history, feed.settled, feed.live, feed.pending, feed.loadingOlder) { history, settled, live, pending, _ ->
            RowInput(history.items + settled, live.snapshot, pending, history.hasOlder, System.currentTimeMillis())
        }.mapLatest(builder::build).flowOn(Dispatchers.Default).stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    }

    val header: StateFlow<ChatHeader> =
        combine(mutableSummary, phone.inboxRows, phone.machines, feed.live.map { it.reconnecting }.distinctUntilChanged()) {
                summary, inbox, machines, reconnecting ->
            val session = feed.session
            val row = inbox.firstOrNull { it.machineId == machineId && it.session == session }
            val state = machines.firstOrNull { it.id == machineId }
            ChatHeader(
                title = summary?.title?.text ?: row?.title,
                agent = machines.agent(machineId, session.backend),
                cwd = summary?.cwd ?: row?.cwd,
                machineName = state?.name ?: row?.machineName.orEmpty(),
                health = state?.health,
                reconnecting = reconnecting,
                inboxState = row?.state,
            )
        }.stateIn(viewModelScope, SharingStarted.Eagerly, ChatHeader(null, phone.machines.value.agent(machineId, route.backend), null, "", null))

    /** False until the first view and the newest page are in, or [REVEAL_LIMIT_MS] passed, so the screen never builds in view. */
    val revealed: StateFlow<Boolean> = MutableStateFlow(false).also { revealed ->
        viewModelScope.launch {
            withTimeoutOrNull(REVEAL_LIMIT_MS) {
                combine(feed.history, feed.live) { history, live -> history.loaded && live.started }.first { it }
            }
            revealed.value = true
        }
    }

    init {
        phone.markSeen(machineId, route)
        feed.start()
        viewModelScope.launch { phone.draft(machineId, route)?.let { composer.prepend(listOf(it)) } }
        viewModelScope.launch { readSummary() }
        viewModelScope.launch {
            feed.live.first { it.ended is ViewEnd.Removed }
            phone.sessionDeleted(sessionKey)
        }
        watchCatalog()
        FirstPrompts.take(machineId, route)?.let { outgoing ->
            viewModelScope.launch {
                feed.live.first { it.started }
                actions.deliver(outgoing)
            }
        }
    }

    private fun watchCatalog() {
        viewModelScope.launch {
            header.map { it.cwd }.distinctUntilChanged().collect { cwd -> catalog.load(feed.session.backend, cwd, feed.session) }
        }
        viewModelScope.launch {
            phone.catalogChanges.filter { it.machineId == machineId && (it.backend == null || it.backend == feed.session.backend) }
                .collect { catalog.load(feed.session.backend, header.value.cwd, feed.session) }
        }
        viewModelScope.launch {
            header.map { it.health?.isOnline == true }.distinctUntilChanged().filter { it }.collect {
                catalog.load(feed.session.backend, header.value.cwd, feed.session)
                images.retryFailed()
                if (mutableSummary.value == null) readSummary()
            }
        }
        viewModelScope.launch {
            combine(feed.history, feed.live) { history, live ->
                history.items + live.snapshot.run?.items.orEmpty()
            }.collect { items ->
                items.forEach { item ->
                    val message = (item as? TranscriptItem.UserMessage)?.v1 ?: return@forEach
                    val requestId = message.clientRequestId ?: return@forEach
                    if (message.attachments.isNotEmpty()) images.bindConfirmed(requestId, message.attachments)
                }
            }
        }
    }

    /** The session's row (title, folder); the inbox's stands in until it comes, and a machine back online reads it again. */
    suspend fun readSummary() {
        val result = try {
            feed.client.summary()
        } catch (_: ClientException) {
            return
        }
        (result as? SessionGetResult.Accepted)?.let { mutableSummary.value = it.v1.summary }
    }

    /**
     * Where this chat's dictation goes: its draft, sent by [send] when the person wants that, with the
     * newest items and the session folder for the names the speech model is told.
     */
    fun dictationTarget(dictation: Dictation, send: () -> Unit) = DictationTarget(
        id = "chat:$machineId:${route.backend}:${route.sessionId}",
        sources = {
            val items = (feed.history.value.items + feed.settled.value + feed.live.value.snapshot.run?.items.orEmpty()).takeLast(DICTATION_ITEMS)
            val cwd = header.value.cwd
            val (folder, git) = cwd?.let { dictation.glance.look(machine, machineId, it) } ?: (null to null)
            DictationSources(items, folder, git, cwd, emptyList())
        },
        insert = composer::appendDictated,
        send = send,
    )

    /** The conversation as plain text, the person's turns and the agent's words, for the clipboard. */
    fun conversationText(): String {
        val items = feed.history.value.items + feed.settled.value + feed.live.value.snapshot.run?.items.orEmpty()
        return items.mapNotNull { item ->
            when (item) {
                is TranscriptItem.UserMessage -> "> " + item.v1.text.replace("\n", "\n> ")
                is TranscriptItem.Block -> item.v1.text.takeIf { item.v1.block == BlockKind.TEXT && item.v1.parentToolCallId == null }
                else -> null
            }
        }.joinToString("\n\n")
    }

    /** Leaves the session unread: the chat goes back to the inbox, and neither leaving nor following it marks it seen. */
    fun markUnread() {
        keepUnread = true
        phone.markUnread(machineId, feed.session)
        mutableEvents.tryEmit(ChatEvent.LeftUnread)
    }

    fun dismiss(notice: ChatNotice) = mutableNotices.update { list -> list.filterNot { it.id == notice.id } }

    fun say(event: ChatEvent) {
        mutableEvents.tryEmit(event)
    }

    private fun moment(change: SessionChange) {
        noticeOf(change)?.let { notice(it.level, it.text) }
        if (change is SessionChange.InputReturned) composer.prepend(change.texts)
    }

    private fun notice(level: NoticeLevel, text: String) {
        mutableNotices.update { (it + ChatNotice(++noticeIds, level, text)).takeLast(MAX_NOTICES) }
    }

    /** A run's info notices are part of its turn in the transcript once it ends; warnings and errors wait to be read. */
    private fun runEnded() = mutableNotices.update { list -> list.filterNot { it.level == NoticeLevel.INFO } }

    private fun followed(session: SessionRef) {
        if (!keepUnread) phone.markSeen(machineId, session)
        mutableSummary.value = null
        viewModelScope.launch { readSummary() }
    }

    override fun onCleared() {
        if (!keepUnread) phone.markSeen(machineId, feed.session)
        phone.saveDraft(machineId, route, composer.input.text.toString())
    }

    private companion object {
        const val REVEAL_LIMIT_MS = 3_000L
        const val MAX_NOTICES = 3
        const val DICTATION_ITEMS = 80
    }
}
