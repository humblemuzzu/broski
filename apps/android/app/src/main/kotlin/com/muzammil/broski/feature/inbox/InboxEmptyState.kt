package com.muzammil.broski.feature.inbox

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.core.MachineName
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.EmptyState
import com.muzammil.broski.design.Orb
import com.muzammil.broski.design.PrimaryButton
import com.muzammil.broski.design.QuietButton
import com.muzammil.broski.design.label
import com.muzammil.broski.design.orb.OrbState
import com.muzammil.broski.design.settling
import uniffi.broski_core.InboxState

/**
 * What an empty inbox says: nothing working under the working filter, nothing matching the other
 * filters or the search, the Macs still on their way, every Mac unreachable, or simply no sessions yet.
 */
@Composable
fun InboxEmptyState(
    state: InboxUiState,
    onClear: () -> Unit,
    onShowAllStates: () -> Unit,
    onNewSession: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val filter = state.filter
    val settling = state.machines.firstOrNull { it.health.settling }
    val unreachable = state.machines.firstOrNull()
    when {
        state.query.isNotEmpty() -> EmptyState(
            title = stringResource(R.string.inbox_no_results, state.query),
            body = stringResource(R.string.inbox_no_results_body),
            modifier = modifier,
        )
        filter.state == InboxState.WORKING -> EmptyState(
            title = stringResource(R.string.inbox_nothing_working),
            body = "",
            modifier = modifier,
            action = { QuietButton(stringResource(R.string.inbox_show_all_states), onShowAllStates) },
        )
        filter.isActive -> EmptyState(
            title = stringResource(R.string.inbox_no_match_title),
            body = stringResource(R.string.inbox_no_match_body, filter.summary(state.machines) ?: stringResource(R.string.inbox_no_match_these)),
            modifier = modifier,
            action = { QuietButton(stringResource(R.string.inbox_filter_clear), onClear) },
        )
        settling != null && !state.anyOnline -> EmptyState(
            title = stringResource(R.string.inbox_connecting_to, settling.name),
            body = settling.health.label(MachineName.display(settling.name)),
            modifier = modifier,
            leading = { Orb(OrbState.CONNECTING, size = 64.dp) },
        )
        unreachable != null && state.machines.none { it.health.isOnline } -> EmptyState(
            title = unreachable.health.label(MachineName.display(unreachable.name)),
            body = stringResource(R.string.inbox_back_soon, unreachable.name),
            modifier = modifier,
        )
        else -> EmptyState(
            title = stringResource(R.string.inbox_empty_title),
            body = stringResource(R.string.inbox_empty_body),
            modifier = modifier,
            action = onNewSession?.let { open -> { PrimaryButton(stringResource(R.string.new_session), open, icon = R.drawable.ic_edit_square) } },
        )
    }
}
