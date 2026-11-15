package com.muzammil.broski.core

import android.util.Log
import com.muzammil.broski.core.vault.Vault
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uniffi.broski_contract.BackendDescriptor
import uniffi.broski_contract.BackendId
import uniffi.broski_contract.BackendStatus
import uniffi.broski_contract.PermissionOption
import uniffi.broski_contract.SessionRef
import uniffi.broski_core.AnswerOutcome
import uniffi.broski_core.ClientException
import uniffi.broski_core.InboxRow
import uniffi.broski_core.Machine
import uniffi.broski_core.MachineEvent
import uniffi.broski_core.Phone

/**
 * The running phone: one [Phone] for the process, its machines and its inbox, each read by one
 * loop in [scope] for as long as it lives. Screens observe the flows and call the actions; nothing
 * here belongs to a screen.
 */
class PhoneSession internal constructor(
    private val phone: Phone,
    private val vault: Vault,
    private val scope: CoroutineScope,
    started: List<Machine>,
    unreadableRecords: Set<String>,
) {
    private val inbox = phone.inbox()
    private val handles = ConcurrentHashMap<String, Machine>()
    private val watchers = ConcurrentHashMap<String, Job>()
    private val lanRoutes = ConcurrentHashMap<String, List<String>>()

    private val rows = MutableStateFlow(inbox.rows())
    private val machineStates = MutableStateFlow<List<MachineState>>(emptyList())
    private val unreadable = MutableStateFlow(unreadableRecords)
    private val catalog = MutableSharedFlow<CatalogChange>(extraBufferCapacity = 16, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    /** Needs you, working, done, idle; newest first within each, as the core orders them. */
    val inboxRows: StateFlow<List<InboxRow>> = rows.asStateFlow()

    /** Every paired machine, oldest pairing first. */
    val machines: StateFlow<List<MachineState>> = machineStates.asStateFlow()

    /** Stored pairings that no longer open; the person can only forget them. */
    val unreadableMachines: StateFlow<Set<String>> = unreadable.asStateFlow()

    /** A machine's catalog changed (models, commands, modes, or its backends): what a screen read of it is out of date. */
    val catalogChanges: SharedFlow<CatalogChange> = catalog.asSharedFlow()

    init {
        started.forEach(::watch)
        scope.launch { readInbox() }
    }

    /** The machine to open views, terminals and lists on, or to send requests to. */
    fun machine(id: String): Machine? = handles[id]

    /** Pairs from a scanned or pasted `broski://pair` link and stores the new record at once. */
    suspend fun pair(offer: String): String {
        val machine = phone.pair(offer)
        val id = machine.id()
        watchers.remove(id)?.cancelAndJoin()
        vault.saveRecord(id, machine.record().use { it.toBytes() })
        watch(machine)
        return id
    }

    /**
     * Ends the pairing here and on the machine, and deletes its record. The watcher and every read
     * it started are over before the record goes, so none can store it again. The handle is not
     * closed: a screen may still hold it, `Phone.forget` already ended the machine, and the
     * binding releases the handle when it is collected.
     */
    suspend fun forget(id: String) {
        watchers.remove(id)?.cancelAndJoin()
        handles.remove(id)
        phone.forget(id)
        machineStates.update { list -> list.filterNot { it.id == id } }
        unreadable.update { it - id }
        vault.deleteRecord(id)
        vault.deleteDrafts(id)
    }

    /** What the person had typed in a session's composer and not sent, if anything. */
    suspend fun draft(machineId: String, session: SessionRef): String? = try {
        vault.draft(draftName(machineId, session))
    } catch (error: IOException) {
        Log.e(TAG, "a draft could not be read", error)
        null
    }

    /** Keeps [text] as the session's draft, past the chat and the process; blank forgets it. */
    fun saveDraft(machineId: String, session: SessionRef, text: String) {
        scope.launch {
            try {
                vault.saveDraft(draftName(machineId, session), text)
            } catch (error: IOException) {
                Log.e(TAG, "a draft could not be stored", error)
            }
        }
    }

    /** @throws ClientException.NotSent when the link would not take the request. */
    fun restartBridge(id: String) {
        handles[id]?.restartBridge()
    }

    /** The person opened or left the session: it is not done again until something happens. */
    fun markSeen(machineId: String, session: SessionRef) = inbox.markSeen(machineId, session)

    suspend fun refresh() = inbox.refresh()

    /**
     * The person tapped Approve or Deny on a row: answers its pending ask with [option], which must
     * be that ask's own `allow` or `deny`.
     *
     * @throws ClientException when the answer could not be sent.
     */
    suspend fun answer(row: InboxRow, option: PermissionOption): AnswerOutcome {
        val pending = requireNotNull(row.pending) { "a row with nothing to answer" }
        return inbox.answer(row.machineId, row.session, pending.interactionId, option.id)
    }

    /** `host:port` routes NSD found for `machineId`, newest first. */
    fun lanDiscovered(machineId: String, routes: List<String>) {
        lanRoutes[machineId] = routes
        handles[machineId]?.lanDiscovered(routes)
    }

    fun pause() = phone.pause()

    fun resume() = phone.resume()

    fun networkChanged() = phone.networkChanged()

    private fun watch(machine: Machine) {
        val id = machine.id()
        handles[id] = machine
        lanRoutes[id]?.let(machine::lanDiscovered)
        val initial = machine.record().use { record ->
            MachineState(
                id = id,
                name = record.name(),
                os = record.os(),
                pairedAtMs = record.pairedAtMs().toLong(),
                health = MachineHealth.Connecting,
                lastSeenMs = null,
                bridgeVersion = null,
            ).with(machine.status())
        }
        machineStates.update { list ->
            (list.filterNot { it.id == id } + initial).sortedBy { it.pairedAtMs }
        }
        watchers[id] = scope.launch { readEvents(machine) }
    }

    private suspend fun readEvents(machine: Machine) = coroutineScope {
        val id = machine.id()
        while (true) {
            when (val event = machine.nextEvent() ?: break) {
                is MachineEvent.StatusChanged -> updateMachine(id) { it.with(event.status) }
                MachineEvent.RecordChanged -> persistRecord(machine)
                is MachineEvent.BackendsChanged -> {
                    catalog.tryEmit(CatalogChange(id, null))
                    launch { readAgents(machine, event.backends) }
                }
                is MachineEvent.BackendStatusChanged -> setAgent(id, event.backend, event.status)
                is MachineEvent.CatalogInvalidated -> catalog.tryEmit(CatalogChange(id, event.backend))
            }
        }
        updateMachine(id) { it.with(machine.status()) }
    }

    private suspend fun readInbox() {
        while (true) {
            val update = inbox.nextChange()
            rows.value = update.rows
            try {
                update.seen?.let { vault.saveSeen(it) }
                update.cache?.let { vault.saveInboxCache(it) }
            } catch (error: IOException) {
                Log.e(TAG, "the inbox's state could not be stored", error)
            }
        }
    }

    private suspend fun persistRecord(machine: Machine) {
        try {
            vault.saveRecord(machine.id(), machine.record().use { it.toBytes() })
        } catch (error: IOException) {
            Log.e(TAG, "a machine's changed record could not be stored", error)
        }
    }

    private suspend fun readAgents(machine: Machine, backends: List<BackendDescriptor>) {
        val id = machine.id()
        updateMachine(id) { state ->
            state.copy(
                agents = backends.map { backend ->
                    state.agents.firstOrNull { it.backend == backend.id } ?: AgentInstall(backend.id, null)
                },
            )
        }
        for (backend in backends) {
            try {
                setAgent(id, backend.id, machine.backendStatus(backend.id))
            } catch (error: ClientException) {
                Log.i(TAG, "the status of ${backend.id} on $id is not known: ${error.message}")
            }
        }
    }

    private fun setAgent(id: String, backend: BackendId, status: BackendStatus) = updateMachine(id) { state ->
        state.copy(agents = state.agents.map { if (it.backend == backend) it.copy(status = status) else it })
    }

    private fun updateMachine(id: String, change: (MachineState) -> MachineState) {
        machineStates.update { list -> list.map { if (it.id == id) change(it) else it } }
    }

    private companion object {
        const val TAG = "PhoneSession"

        fun draftName(machineId: String, session: SessionRef) = "$machineId/${session.backend}/${session.sessionId}"
    }
}

/** [backend]'s catalog on a machine changed; `null` when the machine's list of backends did. */
data class CatalogChange(val machineId: String, val backend: BackendId?)
