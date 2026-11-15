package com.muzammil.broski.feature.newsession

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.core.AgentInstall
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.feature.chat.FirstPrompts
import android.net.Uri
import com.muzammil.broski.feature.chat.composer.Catalog
import com.muzammil.broski.feature.chat.composer.CatalogReader
import com.muzammil.broski.feature.chat.composer.ImageAttachments
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import com.muzammil.broski.feature.chat.composer.ComposerState
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uniffi.broski_contract.BackendId
import uniffi.broski_contract.ClientMessage
import uniffi.broski_contract.ModeSetting
import uniffi.broski_contract.NewSessionOptions
import uniffi.broski_contract.NewSessionResult
import uniffi.broski_contract.PromptMode
import uniffi.broski_contract.Rejection
import uniffi.broski_contract.ServerMessage
import uniffi.broski_contract.SessionCreateRequest
import uniffi.broski_contract.SessionRef
import uniffi.broski_core.ClientException
import uniffi.broski_core.InboxRow

/** What the person has chosen for the session so far. */
@Immutable
data class Choice(
    val machineId: String? = null,
    val folder: String? = null,
    val backend: BackendId? = null,
    val modelId: String? = null,
    val thinking: String? = null,
    val modes: Map<String, String> = emptyMap(),
)

/**
 * The defaults filled in where the person has not chosen: the first online machine, the newest
 * folder its sessions ran in, and the agent used there last, or else the first that can run.
 */
internal fun settled(current: Choice, machines: List<MachineState>, rows: List<InboxRow>): Choice {
    val machineId = current.machineId?.takeIf { id -> machines.any { it.id == id } }
        ?: (machines.firstOrNull { it.health.isOnline } ?: machines.firstOrNull())?.id
    val mine = rows.filter { it.machineId == machineId }
    val folder = current.folder ?: mine.firstNotNullOfOrNull { it.cwd }
    val usable = machines.firstOrNull { it.id == machineId }?.agents.orEmpty().filter { it.status?.usable == true }.map { it.backend }
    val backend = current.backend?.takeIf { it in usable }
        ?: mine.firstOrNull { it.cwd == folder }?.session?.backend?.takeIf { it in usable }
        ?: usable.firstOrNull()
    return current.copy(machineId = machineId, folder = folder, backend = backend)
}

/** The sheet's state: the machines, the recent folders and the agents to pick from, and the choice. */
@Immutable
data class NewSessionUi(
    val machines: List<MachineState>,
    val recentFolders: List<String>,
    val agents: List<AgentInstall>,
    val choice: Choice,
    val creating: Boolean,
)

sealed interface NewSessionEvent {
    data class Created(val machineId: String, val session: SessionRef) : NewSessionEvent

    data class Refused(val rejection: Rejection) : NewSessionEvent

    data class Failed(val error: ClientException) : NewSessionEvent

    data object ImageTooLarge : NewSessionEvent

    data object NoImageToPaste : NewSessionEvent
}

/**
 * New session: the machine, folder and agent ([settled] fills what is not chosen), the catalog for
 * the composer's chips, and the send that creates the session and hands its first prompt to the
 * chat that opens it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NewSessionViewModel(private val phone: PhoneSession, private val attachments: ImageAttachments) : ViewModel() {
    private val choice = MutableStateFlow(Choice())
    private val creating = MutableStateFlow(false)
    private val events = MutableSharedFlow<NewSessionEvent>(extraBufferCapacity = 4)

    val composer = ComposerState("", viewModelScope) {}
    private val reader = MutableStateFlow<CatalogReader?>(null)

    /** The catalog of the chosen agent in the chosen folder, read again whenever either changes. */
    val catalog: StateFlow<Catalog> = reader.flatMapLatest { it?.catalog ?: flowOf(Catalog()) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, Catalog())
    val folders = FolderBrowser(phone, viewModelScope)

    val outcomes: SharedFlow<NewSessionEvent> = events.asSharedFlow()

    val state: StateFlow<NewSessionUi> = combine(phone.machines, phone.inboxRows, choice, creating) { machines, rows, chosen, busy ->
        val machine = machines.firstOrNull { it.id == chosen.machineId }
        NewSessionUi(
            machines = machines,
            recentFolders = rows.filter { it.machineId == chosen.machineId }.mapNotNull { it.cwd }.distinct(),
            agents = machine?.agents.orEmpty(),
            choice = chosen,
            creating = busy,
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, NewSessionUi(emptyList(), emptyList(), emptyList(), Choice(), false))

    init {
        viewModelScope.launch {
            combine(phone.machines, phone.inboxRows) { machines, rows -> machines to rows }.collect { (machines, rows) ->
                choice.update { settled(it, machines, rows) }
            }
        }
        viewModelScope.launch {
            choice.distinctUntilChanged { a, b -> a.machineId == b.machineId }.collect { chosen ->
                val machineId = chosen.machineId ?: return@collect
                if (chosen.folder == null) folders.home(machineId)?.let { home -> choice.update { it.copy(folder = it.folder ?: home) } }
            }
        }
        viewModelScope.launch {
            choice.distinctUntilChanged { a, b -> a.machineId == b.machineId && a.backend == b.backend && a.folder == b.folder }.collect(::readCatalog)
        }
    }

    private fun readCatalog(chosen: Choice) {
        val machine = chosen.machineId?.let(phone::machine) ?: return
        val backend = chosen.backend ?: return
        reader.value = CatalogReader(machine, viewModelScope).also { it.load(backend, chosen.folder, null) }
    }

    fun attachImage(uri: Uri) {
        viewModelScope.launch {
            val image = attachments.read(uri, composer.imageBudget)
            if (image == null) events.emit(NewSessionEvent.ImageTooLarge) else composer.add(image)
        }
    }

    fun noImageToPaste() {
        events.tryEmit(NewSessionEvent.NoImageToPaste)
    }

    fun pickMachine(id: String) = choice.update { Choice(machineId = id) }

    fun pickFolder(path: String) = choice.update { it.copy(folder = path) }

    fun pickAgent(backend: BackendId) = choice.update { it.copy(backend = backend, modelId = null, thinking = null, modes = emptyMap()) }

    fun pickModel(id: String) = choice.update { it.copy(modelId = id, thinking = null) }

    fun pickThinking(value: String) = choice.update { it.copy(thinking = value) }

    fun pickMode(axis: String, value: String) = choice.update { it.copy(modes = it.modes + (axis to value)) }

    /** Creates the session in the chosen folder with the chosen settings; its chat sends the first prompt. */
    fun create() {
        val chosen = choice.value
        val machine = chosen.machineId?.let(phone::machine) ?: return
        val backend = chosen.backend ?: return
        val folder = chosen.folder ?: return
        if (!creating.compareAndSet(expect = false, update = true)) return
        val options = NewSessionOptions(folder, chosen.modelId, chosen.thinking, chosen.modes.map { ModeSetting(it.key, it.value) }.ifEmpty { null })
        viewModelScope.launch {
            try {
                val answer = machine.request(ClientMessage.SessionCreate(SessionCreateRequest("", backend, options))) as ServerMessage.SessionCreateResult
                when (val result = answer.v1.result) {
                    is NewSessionResult.Accepted -> {
                        FirstPrompts.put(chosen.machineId, result.v1.session, composer.take(PromptMode.START))
                        events.emit(NewSessionEvent.Created(chosen.machineId, result.v1.session))
                    }
                    is NewSessionResult.Rejected -> events.emit(NewSessionEvent.Refused(result.v1.rejection))
                }
            } catch (error: ClientException) {
                events.emit(NewSessionEvent.Failed(error))
            } finally {
                creating.value = false
            }
        }
    }
}
