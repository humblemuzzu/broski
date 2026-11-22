package com.muzammil.broski.feature.chat.composer

import android.util.Log
import androidx.compose.runtime.Immutable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
    fun model(id: String?): ModelSummary? = models.firstOrNull { it.id == id } ?: models.firstOrNull { it.isDefault }
}

/**
 * Reads [Catalog]s from a machine's cached catalog (the core keeps each list until the bridge says it
 * changed), again whenever [load] is called: on a new folder and on the machine's catalog changes.
 */
class CatalogReader(private val machine: Machine, private val scope: CoroutineScope) {
    private val mutable = MutableStateFlow(Catalog())
    val catalog: StateFlow<Catalog> = mutable.asStateFlow()
    private var reading: Job? = null

    fun load(backend: String, cwd: String?, session: SessionRef?) {
        reading?.cancel()
        reading = scope.launch { mutable.value = read(backend, cwd, session) }
    }

    private suspend fun read(backend: String, cwd: String?, session: SessionRef?): Catalog = coroutineScope {
        val capabilities = async { quietly { machine.backends().firstOrNull { it.id == backend }?.capabilities } }
        val models = async { quietly { (machine.models(backend, cwd, false) as? ModelsListResult.Accepted)?.v1?.models } }
        val modes = async { quietly { (machine.modes(backend, cwd) as? ModesListResult.Accepted)?.v1?.modes } }
        val commands = async { quietly { (machine.commands(backend, cwd, session) as? CommandsListResult.Accepted)?.v1?.commands } }
        Catalog(capabilities.await(), models.await().orEmpty(), modes.await().orEmpty(), commands.await().orEmpty())
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
