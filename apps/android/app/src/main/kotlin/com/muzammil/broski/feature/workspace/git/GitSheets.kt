package com.muzammil.broski.feature.workspace.git

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.GroupedRow
import com.muzammil.broski.design.PrimaryButton
import com.muzammil.broski.design.SectionHeader
import com.muzammil.broski.design.mono
import com.muzammil.broski.feature.workspace.FailureMessage
import com.muzammil.broski.feature.workspace.WorkspaceLoading
import uniffi.broski_contract.GitBranch

/** The message field and the screen's primary action, docked at the bottom while anything is staged. */
@Composable
fun CommitBar(state: GitUiState, onMessage: (String) -> Unit, onCommit: () -> Unit) {
    val staged = state.status?.staged?.size ?: 0
    Surface(color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.navigationBarsPadding().imePadding().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedTextField(
                value = state.message,
                onValueChange = onMessage,
                label = { Text(stringResource(R.string.git_commit_message)) },
                maxLines = 4,
                enabled = !state.busy,
                modifier = Modifier.fillMaxWidth(),
            )
            PrimaryButton(
                text = pluralStringResource(R.plurals.git_commit, staged, staged),
                onClick = onCommit,
                icon = R.drawable.ic_commit,
                enabled = state.canCommit,
            )
        }
    }
}

/** Local branches, then remote ones; picking another asks first, and git's refusal is shown as git says it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BranchesSheet(state: GitUiState, viewModel: GitViewModel, onDismiss: () -> Unit) {
    var picked by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { viewModel.loadBranches() }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        SectionHeader(stringResource(R.string.git_branches))
        val branches = state.branches
        when {
            branches == null -> WorkspaceLoading(Modifier.padding(32.dp))
            state.branchesFailure != null -> FailureMessage(state.branchesFailure, viewModel::loadBranches)
            else -> LazyColumn(Modifier.padding(bottom = 24.dp)) {
                itemsIndexed(branches, key = { _, branch -> branch.name }) { index, branch ->
                    BranchItem(branch, index, branches.size, enabled = !state.busy) { picked = branch.name }
                }
            }
        }
    }
    val target = picked?.let { name -> state.branches?.firstOrNull { it.name == name } }
    if (target != null) {
        AlertDialog(
            onDismissRequest = { picked = null },
            title = { Text(stringResource(R.string.git_checkout_title, checkoutName(target))) },
            text = { Text(stringResource(R.string.git_checkout_body)) },
            confirmButton = {
                TextButton(onClick = {
                    picked = null
                    viewModel.checkout(target)
                    onDismiss()
                }) { Text(stringResource(R.string.git_checkout)) }
            },
            dismissButton = { TextButton(onClick = { picked = null }) { Text(stringResource(R.string.action_cancel)) } },
        )
    }
}

@Composable
private fun BranchItem(branch: GitBranch, index: Int, count: Int, enabled: Boolean, onPick: () -> Unit) {
    val upstream = branch.upstream
    GroupedRow(
        index = index,
        count = count,
        onClick = if (branch.current || !enabled) null else onPick,
        leading = if (branch.current) ({ Icon(painterResource(R.drawable.ic_check), contentDescription = stringResource(R.string.git_current_branch)) }) else null,
        supporting = when {
            branch.remote -> ({ Text(stringResource(R.string.git_remote_branch)) })
            upstream != null -> ({ Text(upstream.name, style = MaterialTheme.typography.bodySmall.mono()) })
            else -> null
        },
    ) {
        Text(branch.name, style = MaterialTheme.typography.bodyLarge.mono(), maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
    }
}
