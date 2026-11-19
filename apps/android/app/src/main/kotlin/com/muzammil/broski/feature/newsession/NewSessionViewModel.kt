package com.muzammil.broski.feature.newsession

import android.net.Uri
import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.core.AgentInstall
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.core.voice.Dictation
import com.muzammil.broski.core.voice.DictationTarget
import com.muzammil.broski.feature.chat.FirstPrompts
import com.muzammil.broski.feature.chat.composer.Catalog
import com.muzammil.broski.feature.chat.composer.CatalogReader
import com.muzammil.broski.feature.chat.composer.ComposerState
import com.muzammil.broski.feature.chat.composer.ImageAttachments
import com.muzammil.broski.feature.workspace.Answer
import com.muzammil.broski.feature.workspace.WorkspaceClient
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
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
import uniffi.broski_core.DictationSources
import uniffi.broski_core.InboxRow

/**
 * A folder sessions ran in on one Mac, whichever agent ran them: every agent reports each session's real
 * working directory (Claude Code from the session file, Pi from its header), so a project is a folder, not
 * something either agent defines.
 */
@Immutable
data class Project(val path: String, val updatedAt: Long)

/** The folders of the sessions on [machineId], the most recently used first, each once. */
fun projects(rows: List<InboxRow>, machineId: String?): List<Project> = rows
    .filter { it.machineId == machineId }
    .sortedByDescending { it.updatedAt }
    .mapNotNull { row -> row.cwd?.let { Project(it, row.updatedAt) } }
    .distinctBy { it.path }

/** What the person has chosen for the session so far; [agentPicked] says the agent was theirs, not a default. */
@Immutable
data class Choice(
    val machineId: String? = null,
    val folder: String? = null,
    val backend: BackendId? = null,
    val agentPicked: Boolean = false,
    val modelId: String? = null,
    val thinking: String? = null,
    val modes: Map<String, String> = emptyMap(),
)

/** Whether the agent can run now; one whose status has not come yet is taken to. */
val AgentInstall.canRun: Boolean get() = status?.usable != false

/**
 * Fills what the person has not picked. The Mac: the first online, else the first. The folder: the newest
 * session's there. The agent: the one last used in that folder while it can run, else the first that can;
 * one the person picked stays while the Mac can run it. A new agent starts from its own defaults.
 */
internal fun settled(current: Choice, machines: List<MachineState>, rows: List<InboxRow>): Choice {
    val machineId = current.machineId?.takeIf { id -> machines.any { it.id == id } }
        ?: (machines.firstOrNull { it.health.isOnline } ?: machines.firstOrNull())?.id
    val reset = if (machineId == current.machineId) current else Choice(machineId = machineId)
    val folder = reset.folder ?: projects(rows, machineId).firstOrNull()?.path
    val agents = machines.firstOrNull { it.id == machineId }?.agents.orEmpty()
    val runnable = agents.filter { it.canRun }.map { it.backend }
    val keeps = reset.agentPicked && reset.backend in runnable
    val backend = if (keeps) {
        reset.backend
    } else {
        rows.filter { it.machineId == machineId && it.cwd == folder }.maxByOrNull { it.updatedAt }?.session?.backend?.takeIf { it in runnable }
            ?: runnable.firstOrNull()
            ?: agents.firstOrNull()?.backend
    }
    val settled = reset.copy(folder = folder, backend = backend, agentPicked = keeps)
    return if (backend == reset.backend) settled else settled.copy(modelId = null, thinking = null, modes = emptyMap())
}

/** The screen's state: the Mac's folders and agents to pick from, its home, and the choice. */
@Immutable
data class NewSessionUi(
    val machines: List<MachineState>,
    val projects: List<Project>,
    val agents: List<AgentInstall>,
    val choice: Choice,
    val home: String?,
    val creating: Boolean,
) {
    val machine: MachineState? get() = machines.firstOrNull { it.id == choice.machineId }
}

sealed interface NewSessionEvent {
    data class Created(val machineId: String, val session: SessionRef) : NewSessionEvent

    data class Refused(val rejection: Rejection) : NewSessionEvent

    data class Failed(val error: ClientException) : NewSessionEvent

    data object ImageTooLarge : NewSessionEvent

    data object NoImageToPaste : NewSessionEvent
}

/**
 * New session: the Mac, folder and agent ([settled] fills what is not picked), the catalog for the
 * composer's chips, and the send that creates the session and hands its first prompt to the chat it
 * becomes.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NewSessionViewModel(private val phone: PhoneSession, private val attachments: ImageAttachments) : ViewModel() {
    private val choice = MutableStateFlow(Choice())
    private val creating = MutableStateFlow(false)
    private val homes = MutableStateFlow<Map<String, String>>(emptyMap())
    private val events = MutableSharedFlow<NewSessionEvent>(extraBufferCapacity = 4)

    val composer = ComposerState("", viewModelScope) {}
    private val reader = MutableStateFlow<CatalogReader?>(null)

    /** The catalog of the chosen agent in the chosen folder, read again whenever either changes. */
    val catalog: StateFlow<Catalog> = reader.flatMapLatest { it?.catalog ?: flowOf(Catalog()) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, Catalog())

    val outcomes: SharedFlow<NewSessionEvent> = events.asSharedFlow()

    val state: StateFlow<NewSessionUi> = combine(phone.machines, phone.inboxRows, choice, homes, creating) { machines, rows, chosen, known, busy ->
        NewSessionUi(
            machines = machines,
            projects = projects(rows, chosen.machineId),
            agents = machines.firstOrNull { it.id == chosen.machineId }?.agents.orEmpty(),
            choice = chosen,
            home = chosen.machineId?.let(known::get),
            creating = busy,
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, NewSessionUi(emptyList(), emptyList(), emptyList(), Choice(), null, false))

    init {
        viewModelScope.launch {
            combine(phone.machines, phone.inboxRows, choice) { machines, rows, _ -> machines to rows }
                .collect { (machines, rows) -> choice.update { settled(it, machines, rows) } }
        }
        viewModelScope.launch {
            choice.map { it.machineId }.distinctUntilChanged().collect { id -> id?.let { readHome(it) } }
        }
        viewModelScope.launch {
            choice.distinctUntilChanged { a, b -> a.machineId == b.machineId && a.backend == b.backend && a.folder == b.folder }.collect(::readCatalog)
        }
    }

    /** The Mac's home folder, where browsing starts and which paths are written from as `~`. */
    private suspend fun readHome(machineId: String) {
        val machine = phone.machine(machineId) ?: return
        val home = (WorkspaceClient(machine::request).info() as? Answer.Done)?.value?.roots?.firstOrNull() ?: return
        homes.update { it + (machineId to home) }
    }

    private fun readCatalog(chosen: Choice) {
        val machine = chosen.machineId?.let(phone::machine) ?: return
        val backend = chosen.backend ?: return
        reader.value = CatalogReader(machine, viewModelScope).also { it.load(backend, chosen.folder, null) }
    }

    /** The new session's dictation: no transcript yet, only the chosen folder's names. */
    fun dictationTarget(dictation: Dictation) = DictationTarget(
        id = "new-session",
        sources = {
            val chosen = choice.value
            val machineId = chosen.machineId
            val machine = machineId?.let(phone::machine)
            val cwd = chosen.folder
            val (folder, git) = if (machineId != null && machine != null && cwd != null) dictation.glance.look(machine, machineId, cwd) else null to null
            DictationSources(emptyList(), folder, git, cwd, emptyList())
        },
        insert = composer::appendDictated,
        send = null,
    )

    fun attachImage(uri: Uri) {
        viewModelScope.launch {
            val image = attachments.read(uri, composer.imageBudget)
            if (image == null) events.emit(NewSessionEvent.ImageTooLarge) else composer.add(image)
        }
    }

    fun noImageToPaste() {
        events.tryEmit(NewSessionEvent.NoImageToPaste)
    }

    fun pickMachine(id: String) = choice.update { if (it.machineId == id) it else Choice(machineId = id) }

    fun pickFolder(path: String) = choice.update { it.copy(folder = path) }

    fun pickAgent(backend: BackendId) = choice.update {
        if (it.backend == backend) it.copy(agentPicked = true) else it.copy(backend = backend, agentPicked = true, modelId = null, thinking = null, modes = emptyMap())
    }

    fun pickModel(id: String) = choice.update { it.copy(modelId = id, thinking = null) }

    fun pickThinking(value: String) = choice.update { it.copy(thinking = value) }

    fun pickMode(axis: String, value: String) = choice.update { it.copy(modes = it.modes + (axis to value)) }

    /** Searches files under the currently chosen folder for `@file` autocomplete; `null` on failure. */
    suspend fun searchFiles(query: String): List<String>? {
        val chosen = choice.value
        val folder = chosen.folder ?: return null
        val machine = chosen.machineId?.let(phone::machine) ?: return null
        return when (val found = WorkspaceClient(machine::request).search(folder, query, limit = 15L)) {
            is Answer.Done -> found.value.matches.map {
                if (it.kind == uniffi.broski_contract.FileKind.DIR && !it.path.endsWith("/")) "${it.path}/" else it.path
            }
            is Answer.Failed -> null
        }
    }

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
