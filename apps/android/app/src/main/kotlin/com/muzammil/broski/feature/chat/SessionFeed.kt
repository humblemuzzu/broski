package com.muzammil.broski.feature.chat

import android.util.Log
import com.muzammil.broski.feature.chat.transcript.PendingSend
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uniffi.broski_contract.SessionRef
import uniffi.broski_contract.TranscriptItem
import uniffi.broski_contract.TranscriptReadResult
import uniffi.broski_core.ClientException
import uniffi.broski_core.Machine
import uniffi.broski_core.SessionChange
import uniffi.broski_core.SessionUpdate

/**
 * A chat's conversation: the view of the live session, applied update by update, and the finished
 * runs read from the transcript, newest page first and older pages as the person scrolls up.
 *
 * When a run ends its items stay on screen ([settled]) until the newest page, read again, holds
 * them (contract README §8), so the turn never blinks out; an activity outside any run stays the
 * same way, since no run item holds it. The view lives exactly as long as its
 * loop (mobile-packaging.md §1): attached in the coroutine, detached in `finally`.
 */
class SessionFeed(
    private val machine: Machine,
    route: SessionRef,
    private val scope: CoroutineScope,
    private val onMoment: (SessionChange) -> Unit,
    private val onSessionChanged: (SessionRef) -> Unit,
    private val onRunEnded: () -> Unit,
) {
    private val mutableLive = MutableStateFlow(LiveSession())
    private val mutableHistory = MutableStateFlow(History())
    private val mutableSettled = MutableStateFlow<List<TranscriptItem>>(emptyList())
    private val mutablePending = MutableStateFlow<List<PendingSend>>(emptyList())
    private val mutableLoadingOlder = MutableStateFlow(false)
    private var newest: Job? = null

    /** The session the view shows now: the route's, or the one a replacement handed it to. */
    @Volatile
    var session: SessionRef = route
        private set

    val client = SessionClient(machine) { session }
    val live: StateFlow<LiveSession> = mutableLive.asStateFlow()
    val history: StateFlow<History> = mutableHistory.asStateFlow()
    val settled: StateFlow<List<TranscriptItem>> = mutableSettled.asStateFlow()
    val pending: StateFlow<List<PendingSend>> = mutablePending.asStateFlow()
    val loadingOlder: StateFlow<Boolean> = mutableLoadingOlder.asStateFlow()

    fun start() {
        scope.launch { follow() }
        readNewest()
    }

    private suspend fun follow() {
        val view = machine.attach(session)
        try {
            while (true) apply(view.nextUpdate() ?: break)
        } finally {
            view.detach()
            view.close()
        }
    }

    private fun apply(update: SessionUpdate) {
        val before = mutableLive.value
        val applied = before.apply(update)
        mutableLive.value = applied.session
        applied.moments.forEach(onMoment)
        val loose = applied.moments.filterIsInstance<SessionChange.ActivityShown>().map { TranscriptItem.Activity(it.item) }
        if (loose.isNotEmpty()) mutableSettled.update { it + loose }
        val now = applied.session.session
        if (now != null && now != session) {
            session = now
            mutableHistory.value = History()
            mutableSettled.value = emptyList()
            onSessionChanged(now)
            readNewest()
        } else if (applied.endedRuns.isNotEmpty()) {
            mutableSettled.update { settled -> settled + applied.endedRuns.flatMap { it.items } }
            readNewest()
            onRunEnded()
        }
        prunePending()
    }

    fun sent(send: PendingSend) = mutablePending.update { it + send }

    /** A send the bridge did not take, or took without a message of its own (a command it handled). */
    fun withdrawn(clientRequestId: String) = mutablePending.update { list -> list.filterNot { it.clientRequestId == clientRequestId } }

    /** Reads the newest page again, keeping what is settled on screen until the page holds it. */
    fun readNewest() {
        newest?.cancel()
        newest = scope.launch {
            val settledAtStart = mutableSettled.value.size
            var pause = RETRY_START_MS
            while (true) {
                when (val result = read(null)) {
                    is TranscriptReadResult.Accepted -> {
                        mutableHistory.update { it.withNewest(result.v1.page) }
                        mutableSettled.update { it.drop(settledAtStart) }
                        prunePending()
                        return@launch
                    }
                    is TranscriptReadResult.Rejected -> {
                        Log.i(TAG, "the transcript was refused: ${result.v1.rejection.message}")
                        mutableHistory.update { it.copy(loaded = true) }
                        return@launch
                    }
                    null -> Unit
                }
                delay(pause)
                pause = (pause * 2).coerceAtMost(RETRY_MAX_MS)
            }
        }
    }

    fun loadOlder() {
        val cursor = mutableHistory.value.olderCursor ?: return
        if (!mutableLoadingOlder.compareAndSet(expect = false, update = true)) return
        scope.launch {
            try {
                (read(cursor) as? TranscriptReadResult.Accepted)?.let { page -> mutableHistory.update { it.withOlder(page.v1.page) } }
            } finally {
                mutableLoadingOlder.value = false
            }
        }
    }

    /** The page, or `null` when the request did not reach the bridge or got no answer. */
    private suspend fun read(cursor: String?): TranscriptReadResult? = try {
        client.transcript(cursor)
    } catch (error: ClientException) {
        Log.i(TAG, "the transcript could not be read: ${error.message}")
        null
    }

    private fun prunePending() {
        val pending = mutablePending.value
        if (pending.isEmpty()) return
        val snapshot = mutableLive.value.snapshot
        val items = mutableHistory.value.items + mutableSettled.value + snapshot.run?.items.orEmpty()
        val shown = items.mapNotNullTo(HashSet()) { (it as? TranscriptItem.UserMessage)?.v1?.clientRequestId } +
            snapshot.queue.mapNotNull { it.clientRequestId }
        if (pending.any { it.clientRequestId in shown }) mutablePending.update { list -> list.filterNot { it.clientRequestId in shown } }
    }

    private companion object {
        const val TAG = "SessionFeed"
        const val RETRY_START_MS = 2_000L
        const val RETRY_MAX_MS = 30_000L
    }
}
