package com.muzammil.broski.app

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.navigation3.runtime.NavKey
import com.muzammil.broski.R
import kotlinx.serialization.Serializable
import uniffi.broski_contract.SessionRef

/** Every destination. Sealed and serializable, so back stacks survive process death without reflection. */
@Serializable
sealed interface Route : NavKey

@Serializable
data object InboxRoute : Route

@Serializable
data object SettingsRoute : Route

@Serializable
data object MachinesRoute : Route

/** Remote Mac screen view for one paired machine. */
@Serializable
data class ScreenRoute(val machineId: String) : Route

@Serializable
data object PairRoute : Route

/** Settings › Voice: the xAI key, the language and the person's own words. */
@Serializable
data object VoiceRoute : Route

/** The Usage tab: every plan's limits (Claude, Antigravity, …) across paired Macs. */
@Serializable
data object UsageRoute : Route

/** Settings › Notifications: which kinds alert, and Live Updates. */
@Serializable
data object NotificationSettingsRoute : Route

/** Settings › Appearance: light or dark, wallpaper colours, keeping the screen awake, and reading. */
@Serializable
data object AppearanceRoute : Route

/** Settings › Experimental: opt-in features that stay off on both phone and Mac until turned on. */
@Serializable
data object ExperimentalRoute : Route

/** Settings › About: the version, the source, the licence, and protocol versions. */
@Serializable
data object AboutRoute : Route

/** A session yet to be made: the chat it becomes once sent, on whichever Mac and in whichever folder the person picks. */
@Serializable
data object NewSessionRoute : Route

/** One session on one machine: the chat. The backend is kept by its wire id (`claude-code`, `pi`). */
@Serializable
data class SessionRoute(val machineId: String, val backend: String, val sessionId: String) : Route {
    val session: SessionRef get() = SessionRef(backend, sessionId)

    companion object {
        fun of(machineId: String, session: SessionRef) = SessionRoute(machineId, session.backend, session.sessionId)
    }
}

/** A folder on one machine, as the chat's Files button opens the session's. */
@Serializable
data class FilesRoute(val machineId: String, val path: String) : Route

/** One file on one machine, read in the viewer, opened at [line] when one is given. */
@Serializable
data class FileRoute(val machineId: String, val path: String, val line: Int? = null) : Route

/** The git repository that `cwd` lies in. */
@Serializable
data class GitRoute(val machineId: String, val cwd: String) : Route

/** One file's diff in a repository: the index against HEAD when `staged`, else the work tree against the index. */
@Serializable
data class DiffRoute(val machineId: String, val cwd: String, val path: String, val staged: Boolean) : Route

/** One of a machine's terminals; `cwd` names it until the bridge's summary arrives. */
@Serializable
data class TerminalRoute(val machineId: String, val terminalId: String, val cwd: String) : Route

/** The navigation bar's destinations, in its order, each drawn as its icon alone; [label] is what TalkBack reads. */
enum class TopLevel(
    val root: Route,
    @param:StringRes val label: Int,
    @param:DrawableRes val icon: Int,
    @param:DrawableRes val selectedIcon: Int,
) {
    Inbox(InboxRoute, R.string.nav_inbox, R.drawable.ic_chat, R.drawable.ic_chat_fill1),
    Usage(UsageRoute, R.string.nav_usage, R.drawable.ic_bar_chart, R.drawable.ic_bar_chart),
    Settings(SettingsRoute, R.string.nav_settings, R.drawable.ic_settings, R.drawable.ic_settings_fill1),
}
