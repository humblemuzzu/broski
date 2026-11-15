package com.muzammil.broski.app

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.navigation3.runtime.NavKey
import com.muzammil.broski.R
import kotlinx.serialization.Serializable
import uniffi.broski_contract.BackendId
import uniffi.broski_contract.SessionRef

/** Every destination. Sealed and serializable, so back stacks survive process death without reflection. */
@Serializable
sealed interface Route : NavKey

@Serializable
data object InboxRoute : Route

@Serializable
data object WorkspaceRoute : Route

@Serializable
data object SettingsRoute : Route

@Serializable
data object MachinesRoute : Route

@Serializable
data object PairRoute : Route

/** One session on one machine: the chat. The backend is kept by its enum name. */
@Serializable
data class SessionRoute(val machineId: String, val backend: String, val sessionId: String) : Route {
    val session: SessionRef get() = SessionRef(BackendId.valueOf(backend), sessionId)

    companion object {
        fun of(machineId: String, session: SessionRef) = SessionRoute(machineId, session.backend.name, session.sessionId)
    }
}

/** A folder on one machine in the Workspace's file browser, as the chat's "Open folder in Files" asks for it. */
@Serializable
data class FilesRoute(val machineId: String, val path: String) : Route

/** One file on one machine, read in the viewer. */
@Serializable
data class FileRoute(val machineId: String, val path: String) : Route

/** The git repository that `cwd` lies in. */
@Serializable
data class GitRoute(val machineId: String, val cwd: String) : Route

/** One file's diff in a repository: the index against HEAD when `staged`, else the work tree against the index. */
@Serializable
data class DiffRoute(val machineId: String, val cwd: String, val path: String, val staged: Boolean) : Route

/** One of a machine's terminals; `cwd` names it until the bridge's summary arrives. */
@Serializable
data class TerminalRoute(val machineId: String, val terminalId: String, val cwd: String) : Route

/** The navigation bar's destinations, in its order. */
enum class TopLevel(
    val root: Route,
    @param:StringRes val label: Int,
    @param:DrawableRes val icon: Int,
    @param:DrawableRes val selectedIcon: Int,
) {
    Inbox(InboxRoute, R.string.nav_inbox, R.drawable.ic_inbox, R.drawable.ic_inbox_fill1),
    Workspace(WorkspaceRoute, R.string.nav_workspace, R.drawable.ic_code_blocks, R.drawable.ic_code_blocks_fill1),
    Settings(SettingsRoute, R.string.nav_settings, R.drawable.ic_settings, R.drawable.ic_settings_fill1),
}
