package com.muzammil.broski.feature.newsession

import androidx.compose.runtime.Immutable
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.feature.workspace.Answer
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceFailure
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import uniffi.broski_contract.FileKind

/** One folder being browsed for the session to run in: its subfolders, or why they could not be listed. */
@Immutable
data class FolderListing(
    val path: String,
    val roots: List<String>,
    val folders: List<String> = emptyList(),
    val loading: Boolean = true,
    val failure: WorkspaceFailure? = null,
)

/**
 * Browses a machine's folders with the workspace's own requests: from the roots `workspace.info`
 * names (home first), down through `fs.list`, folders only.
 */
class FolderBrowser(private val phone: PhoneSession, private val scope: CoroutineScope) {
    private val mutable = MutableStateFlow<FolderListing?>(null)
    val listing: StateFlow<FolderListing?> = mutable.asStateFlow()
    private var reading: Job? = null

    private fun client(machineId: String) = phone.machine(machineId)?.let { WorkspaceClient(it::request) }

    /** The machine's first workspace root, its home; `null` when it cannot be asked. */
    suspend fun home(machineId: String): String? = (client(machineId)?.info() as? Answer.Done)?.value?.roots?.firstOrNull()

    fun open(machineId: String, path: String?) {
        val client = client(machineId) ?: return
        reading?.cancel()
        reading = scope.launch {
            val roots = (client.info() as? Answer.Done)?.value?.roots.orEmpty()
            val folder = path ?: roots.firstOrNull() ?: return@launch
            mutable.value = FolderListing(folder, roots)
            mutable.value = when (val answer = client.list(folder, cursor = null, hidden = false)) {
                is Answer.Done -> FolderListing(
                    answer.value.path,
                    roots,
                    answer.value.entries.filter { it.kind == FileKind.DIR }.map { it.name },
                    loading = false,
                )
                is Answer.Failed -> FolderListing(folder, roots, loading = false, failure = answer.failure)
            }
        }
    }

    fun close() {
        reading?.cancel()
        mutable.value = null
    }
}
