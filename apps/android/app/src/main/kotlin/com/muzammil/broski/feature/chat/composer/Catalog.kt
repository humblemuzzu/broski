package com.muzammil.broski.feature.chat.composer

import android.util.Log
import androidx.compose.runtime.Immutable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uniffi.broski_contract.Capabilities
import uniffi.broski_contract.CommandSummary
import uniffi.broski_contract.CommandsListResult
import uniffi.broski_contract.ModeAxis
import uniffi.broski_contract.ModelSummary
import uniffi.broski_contract.ModelsListResult
import uniffi.broski_contract.ModesListResult
import uniffi.broski_contract.SessionRef
import uniffi.broski_core.ClientException
import uniffi.broski_core.Machine

/** What an agent on a machine offers the composer in a folder: its capabilities, models, modes and commands. */
@Immutable
data class Catalog(
    val capabilities: Capabilities? = null,
    val models: List<ModelSummary> = emptyList(),
    val modes: List<ModeAxis> = emptyList(),
    val commands: List<CommandSummary> = emptyList(),
) {
    fun model(id: String?): ModelSummary? =
        models.firstOrNull { it.id == id } ?: models.firstOrNull { it.isDefault } ?: models.firstOrNull()
}

/**
 * Reads [Catalog]s from a machine's cached catalog (the core keeps each list until the bridge says it
 * changed), again whenever [load] is called: on a new folder and on the machine's catalog changes.
 * Each list updates independently as soon as it arrives and keeps its previous value across transient
 * failures for the same backend, so a slow commands probe never blocks the model picker.
 */
class CatalogReader(private val machine: Machine, private val scope: CoroutineScope) {
    private val mutable = MutableStateFlow(Catalog())
    val catalog: StateFlow<Catalog> = mutable.asStateFlow()
    private var loadedBackend: String? = null
    private var reading: Job? = null

    fun load(backend: String, cwd: String?, session: SessionRef?) {
        reading?.cancel()
        if (loadedBackend != backend) {
            loadedBackend = backend
            mutable.value = Catalog()
        }
        reading = scope.launch {
            launch {
                quietly { machine.backends().firstOrNull { it.id == backend }?.capabilities }
                    ?.let { caps -> mutable.update { it.copy(capabilities = caps) } }
            }
            launch {
                quietly { (machine.models(backend, cwd, false) as? ModelsListResult.Accepted)?.v1?.models }
                    ?.let { list -> mutable.update { it.copy(models = list) } }
            }
            launch {
                quietly { (machine.modes(backend, cwd) as? ModesListResult.Accepted)?.v1?.modes }
                    ?.let { list -> mutable.update { it.copy(modes = list) } }
            }
            launch {
                quietly { (machine.commands(backend, cwd, session) as? CommandsListResult.Accepted)?.v1?.commands }
                    ?.let { list -> mutable.update { it.copy(commands = list) } }
            }
        }
    }

    private suspend fun <T> quietly(read: suspend () -> T?): T? = try {
        read()
    } catch (error: ClientException) {
        Log.i(TAG, "a catalog list could not be read: ${error.message}")
        null
    }

    private companion object {
        const val TAG = "CatalogReader"
    }
}
