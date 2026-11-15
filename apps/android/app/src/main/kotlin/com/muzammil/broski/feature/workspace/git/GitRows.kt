package com.muzammil.broski.feature.workspace.git

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.GroupedRow
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.SectionHeader
import com.muzammil.broski.design.mono
import com.muzammil.broski.design.perform
import com.muzammil.broski.design.relativeTime
import kotlinx.coroutines.launch
import uniffi.broski_contract.GitChange
import uniffi.broski_contract.GitCommit
import uniffi.broski_contract.GitStatusRead

@Composable
fun BranchHeader(status: GitStatusRead) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainer,
        shape = MaterialTheme.shapes.large,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(painterResource(R.drawable.ic_call_split), contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(12.dp))
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    status.branch ?: stringResource(R.string.git_detached, status.head?.take(SHORT_HASH) ?: "—"),
                    style = MaterialTheme.typography.titleMedium.mono(),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(upstreamLine(status), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun upstreamLine(status: GitStatusRead): String {
    val upstream = status.upstream ?: return stringResource(R.string.git_no_upstream)
    val parts = buildList {
        add(upstream.name)
        if (upstream.ahead > 0) add(pluralStringResource(R.plurals.git_ahead, upstream.ahead.toInt(), upstream.ahead))
        if (upstream.behind > 0) add(pluralStringResource(R.plurals.git_behind, upstream.behind.toInt(), upstream.behind))
        if (upstream.ahead == 0L && upstream.behind == 0L) add(stringResource(R.string.git_up_to_date))
    }
    return parts.joinToString(" · ")
}

@Composable
fun CleanTree() {
    Text(
        stringResource(R.string.git_clean),
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 24.dp),
    )
}

@Composable
fun SectionTitle(section: ChangeSection, enabled: Boolean, onAll: () -> Unit) {
    val title = when (section.area) {
        Area.Staged -> R.string.git_section_staged
        Area.Unstaged -> R.string.git_section_unstaged
        Area.Untracked -> R.string.git_section_untracked
    }
    Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.fillMaxWidth().padding(end = 12.dp)) {
        SectionHeader(stringResource(title, section.rows.size), Modifier.weight(1f))
        TextButton(onClick = onAll, enabled = enabled) {
            Text(stringResource(if (section.area == Area.Staged) R.string.git_unstage_all else R.string.git_stage_all))
        }
    }
}

/**
 * One changed file. Swiping it across stages it (or unstages a staged one); TalkBack offers the
 * same as an action. Tapping opens its diff.
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
    val toggleLabel = stringResource(if (row.area == Area.Staged) R.string.git_unstage else R.string.git_stage)
    SwipeToDismissBox(
        state = swipe,
        backgroundContent = { SwipeBackground(toggleLabel, row.area) },
        enableDismissFromEndToStart = false,
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
            modifier = Modifier.semantics {
                customActions = listOf(
                    CustomAccessibilityAction(toggleLabel) {
                        onToggle()
                        true
                    },
                )
            },
            leading = { ChangeMark(row) },
            supporting = row.folder?.let { folder -> { Text(folder, style = MaterialTheme.typography.bodySmall.mono(), maxLines = 1, overflow = TextOverflow.StartEllipsis) } },
            trailing = counts(row),
        ) {
            Text(row.name, maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
        }
    }
}

@Composable
private fun SwipeBackground(label: String, area: Area) {
    val color = if (area == Area.Staged) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.primaryContainer
    Box(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp)
            .padding(bottom = ListItemDefaults.SegmentedGap)
            .background(color, MaterialTheme.shapes.large)
            .padding(horizontal = 20.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(painterResource(if (area == Area.Staged) R.drawable.ic_remove else R.drawable.ic_add), contentDescription = null)
            Text(label, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun ChangeMark(row: ChangeRow) {
    val colors = MaterialTheme.colorScheme
    val tint: Color = when (row.change) {
        GitChange.ADDED -> BroskiTheme.semantic.done
        GitChange.DELETED, GitChange.CONFLICTED -> colors.error
        GitChange.MODIFIED, GitChange.TYPE_CHANGED -> BroskiTheme.semantic.working
        GitChange.RENAMED, GitChange.COPIED -> colors.tertiary
        null -> colors.onSurfaceVariant
    }
    Box(
        Modifier.size(with(LocalDensity.current) { MARK_SIZE.toDp() }).background(tint.copy(alpha = MARK_ALPHA), CircleShape).clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        Text(row.letter, style = MaterialTheme.typography.labelLarge.mono(), fontWeight = FontWeight.Bold, color = tint)
    }
}

private fun counts(row: ChangeRow): (@Composable () -> Unit)? {
    if (row.additions == null && row.deletions == null) return null
    return {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            row.additions?.let { Text("+$it", style = MaterialTheme.typography.labelLarge.mono(), color = BroskiTheme.semantic.done) }
            row.deletions?.let { Text("−$it", style = MaterialTheme.typography.labelLarge.mono(), color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
fun CommitItem(commit: GitCommit, index: Int, count: Int) {
    GroupedRow(
        index = index,
        count = count,
        onClick = null,
        leading = {
            Text(commit.hash.take(SHORT_HASH), style = MaterialTheme.typography.labelLarge.mono(), color = MaterialTheme.colorScheme.primary)
        },
        supporting = { Text("${commit.author} · ${relativeTime(commit.authoredAt)}", maxLines = 1, overflow = TextOverflow.Ellipsis) },
    ) {
        Text(commit.subject, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

private const val MARK_ALPHA = 0.16f

/** In sp so the circle grows with the letter at large font sizes. */
private val MARK_SIZE = 28.sp
