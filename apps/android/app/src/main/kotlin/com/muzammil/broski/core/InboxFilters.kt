package com.muzammil.broski.core

import androidx.compose.runtime.Immutable
import com.muzammil.broski.core.settings.SettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import uniffi.broski_core.InboxRow
import uniffi.broski_core.InboxState

/**
 * What the inbox narrows to: one state (the working capsule's), one agent, one Mac, one folder. The
 * agent, Mac and folder are kept on the phone; the state is not.
 */
@Immutable
data class InboxFilter(
    val state: InboxState? = null,
    val backend: String? = null,
    val machineId: String? = null,
    val folder: String? = null,
) {
    val isActive: Boolean get() = state != null || backend != null || machineId != null || folder != null

    fun admits(row: InboxRow): Boolean =
        (backend == null || backend == row.session.backend) &&
            (machineId == null || machineId == row.machineId) &&
            (folder == null || folder == row.cwd)
}

/**
 * The one inbox filter of the app, shared by the inbox and the working capsule beside the tab bar,
 * its agent, Mac and folder saved as they change and read back at launch.
 */
class InboxFilters(private val store: SettingsStore, private val scope: CoroutineScope) {
    private val mutable = MutableStateFlow(InboxFilter())
    val filter: StateFlow<InboxFilter> = mutable.asStateFlow()

    init {
        scope.launch {
            val saved = store.settings.first().inbox
            if (mutable.value == InboxFilter()) mutable.value = saved
        }
    }

    fun set(filter: InboxFilter) {
        val old = mutable.value
        if (old == filter) return
        mutable.value = filter
        if (old.copy(state = null) != filter.copy(state = null)) scope.launch { store.setInboxFilter(filter) }
    }

    fun update(change: (InboxFilter) -> InboxFilter) = set(change(mutable.value))
}
