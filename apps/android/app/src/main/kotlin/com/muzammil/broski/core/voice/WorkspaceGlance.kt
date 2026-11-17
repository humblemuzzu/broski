package com.muzammil.broski.core.voice

import com.muzammil.broski.feature.workspace.Answer
import com.muzammil.broski.feature.workspace.Requester
import com.muzammil.broski.feature.workspace.WorkspaceClient
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import uniffi.broski_contract.FilesListed
import uniffi.broski_contract.GitStatusRead
import uniffi.broski_core.Machine

/**
 * A session folder's listing and git status, asked of the Mac at most once a minute per folder while
 * dictating. Dictation needs no Mac: a Mac that does not answer leaves both `null`.
 */
class WorkspaceGlance {
    private class Seen(val atMs: Long, val folder: FilesListed?, val git: GitStatusRead?)

    private val seen = ConcurrentHashMap<String, Seen>()

    suspend fun look(machine: Machine, machineId: String, cwd: String): Pair<FilesListed?, GitStatusRead?> {
        val key = "$machineId\n$cwd"
        val now = System.currentTimeMillis()
        seen[key]?.takeIf { now - it.atMs < FRESH_MS }?.let { return it.folder to it.git }
        val client = WorkspaceClient(Requester { machine.request(it) })
        val found = coroutineScope {
            val folder = async { (client.list(cwd, cursor = null, hidden = false) as? Answer.Done)?.value }
            val git = async { (client.status(cwd) as? Answer.Done)?.value }
            folder.await() to git.await()
        }
        seen[key] = Seen(now, found.first, found.second)
        return found
    }

    private companion object {
        const val FRESH_MS = 60_000L
    }
}
