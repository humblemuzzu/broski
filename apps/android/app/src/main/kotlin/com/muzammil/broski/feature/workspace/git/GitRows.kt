package com.muzammil.broski.feature.workspace.git

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.ui.graphics.Shape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.Grouped
import com.muzammil.broski.design.GroupedRow
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.code.CodeColors
import com.muzammil.broski.design.mono
import com.muzammil.broski.design.perform
import com.muzammil.broski.design.relativeTime
import com.muzammil.broski.feature.workspace.WorkspaceType
import kotlinx.coroutines.launch
import uniffi.broski_contract.GitChange
import uniffi.broski_contract.GitCommit
import uniffi.broski_contract.GitStatusRead

/** The branch, or the commit a detached HEAD sits on, and how far it is from its upstream; opens Branches. */
@Composable
fun BranchRow(status: GitStatusRead, onOpen: () -> Unit) {
    val upstream = status.upstream?.summary()
    GroupedRow(
        index = 0,
        count = 1,
        onClick = onOpen,
        leading = { Icon(painterResource(R.drawable.ic_call_split), contentDescription = null, tint = MaterialTheme.colorScheme.onSurface) },
        supporting = upstream?.let { { Text(it, style = WorkspaceType.footnote) } },
    ) {
        Text(
            status.branch ?: stringResource(
                R.string.git_detached,
                status.head?.take(SHORT_HASH) ?: stringResource(R.string.git_detached_no_commit),
            ),
            style = WorkspaceType.bodySemibold,
        )
    }
}

@Composable
fun CleanTree() {
    GroupedRow(
        index = 0,
        count = 1,
        onClick = null,
        leading = { Icon(painterResource(R.drawable.ic_check_circle), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
    ) {
        Text(stringResource(R.string.git_clean), style = WorkspaceType.body, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** "Staged  3" and its Stage All / Unstage All. */
@Composable
fun SectionTitle(section: ChangeSection, enabled: Boolean, onAll: () -> Unit) {
    val title = when (section.area) {
        Area.Staged -> R.string.git_area_staged
        Area.Unstaged -> R.string.git_area_unstaged
        Area.Untracked -> R.string.git_area_untracked
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(start = 32.dp, end = 24.dp, top = 12.dp),
    ) {
        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(title), style = WorkspaceType.subheadlineSemibold)
            Text(section.rows.size.toString(), style = WorkspaceType.subheadline, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        TextButton(onClick = onAll, enabled = enabled) {
            Text(
                stringResource(if (section.area == Area.Staged) R.string.git_unstage_all else R.string.git_stage_all),
                style = WorkspaceType.subheadline,
            )
        }
    }
}

/**
 * One changed file. Swiping it toward the start stages it (or unstages a staged one), as does its
 * long-press menu and a TalkBack action. Tapping opens its diff.
 */
@Composable
fun ChangeItem(
    row: ChangeRow,
    index: Int,
    count: Int,
    enabled: Boolean,
    onOpen: () -> Unit,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val swipe = rememberSwipeToDismissBoxState()
    var menu by remember { mutableStateOf(false) }
    val staged = row.area == Area.Staged
    val toggleLabel = stringResource(if (staged) R.string.git_unstage else R.string.git_stage)
    SwipeToDismissBox(
        state = swipe,
        backgroundContent = {
            if (swipe.dismissDirection != SwipeToDismissBoxValue.Settled) SwipeBackground(toggleLabel, staged, Grouped.shape(index, count))
        },
        enableDismissFromStartToEnd = false,
        gesturesEnabled = enabled,
        onDismiss = {
            haptics.perform(Haptic.Success)
            onToggle()
            scope.launch { swipe.reset() }
        },
        modifier = modifier,
    ) {
        GroupedRow(
            index = index,
            count = count,
            onClick = onOpen,
            onLongClick = {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                menu = true
            },
            modifier = Modifier.semantics { customActions = listOf(CustomAccessibilityAction(toggleLabel) { onToggle(); true }) },
            leading = { ChangeBadge(row.change) },
            supporting = (row.previousPath?.let { stringResource(R.string.git_from, it) } ?: row.folder)?.let { detail ->
                { Text(detail, style = WorkspaceType.footnote, maxLines = 1, overflow = TextOverflow.StartEllipsis) }
            },
            trailing = counts(row),
        ) {
            Box {
                Text(row.name, style = WorkspaceType.bodyMedium, maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text(toggleLabel) },
                        enabled = enabled,
                        leadingIcon = { Icon(painterResource(if (staged) R.drawable.ic_remove else R.drawable.ic_add), contentDescription = null) },
                        onClick = {
                            menu = false
                            onToggle()
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun SwipeBackground(label: String, staged: Boolean, shape: Shape) {
    val color = if (staged) BroskiTheme.semantic.caution else BroskiTheme.semantic.done
    Box(
        Modifier
            .fillMaxSize()
            .padding(horizontal = Grouped.margin)
            .background(color, shape)
            .padding(horizontal = 20.dp),
        contentAlignment = Alignment.CenterEnd,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(painterResource(if (staged) R.drawable.ic_remove else R.drawable.ic_add), contentDescription = null, tint = Color.White)
            Text(label, style = WorkspaceType.subheadlineSemibold, color = Color.White)
        }
    }
}

/** The letter `git status --short` prints, on a small tinted square. */
@Composable
private fun ChangeBadge(change: GitChange?) {
    val colors = CodeColors.current
    val tint = when (change) {
        GitChange.ADDED, null -> colors.added
        GitChange.DELETED -> colors.removed
        GitChange.CONFLICTED -> BroskiTheme.semantic.caution
        GitChange.MODIFIED, GitChange.RENAMED, GitChange.COPIED, GitChange.TYPE_CHANGED -> BroskiTheme.semantic.highlight
    }
    val side = with(LocalDensity.current) { 20.sp.toDp() }
    Box(
        Modifier.size(side).background(tint.copy(alpha = 0.14f), RoundedCornerShape(4.dp)).clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        Text(letter(change), style = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Bold).mono(), color = tint)
    }
}

private fun counts(row: ChangeRow): (@Composable () -> Unit)? {
    val added = row.additions?.takeIf { it > 0 }
    val removed = row.deletions?.takeIf { it > 0 }
    if (added == null && removed == null) return null
    return {
        val colors = CodeColors.current
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            added?.let { Text("+$it", style = WorkspaceType.codeMedium, color = colors.added) }
            removed?.let { Text("−$it", style = WorkspaceType.codeMedium, color = colors.removed) }
        }
    }
}

@Composable
fun CommitItem(commit: GitCommit, index: Int, count: Int) {
    GroupedRow(
        index = index,
        count = count,
        onClick = null,
        supporting = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(commit.hash.take(SHORT_HASH), style = WorkspaceType.code)
                Text(commit.author, style = WorkspaceType.footnote, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                Text(relativeTime(commit.authoredAt), style = WorkspaceType.footnote, maxLines = 1)
            }
        },
    ) {
        Text(commit.subject, style = WorkspaceType.subheadline, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}
