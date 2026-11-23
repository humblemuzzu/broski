package com.muzammil.broski.feature.workspace.git

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.GlassSurface
import com.muzammil.broski.design.LoadingOrb
import com.muzammil.broski.design.PrimaryButton
import com.muzammil.broski.design.orb.OrbState
import com.muzammil.broski.design.orb.OrbTheme
import com.muzammil.broski.feature.workspace.WorkspaceType

private val ControlHeight = 36.dp
private val Inset = 8.dp
private val Radius = 26.dp
private const val ACCESSIBILITY_FONT_SCALE = 1.6f

/**
 * The commit message in one floating glass surface with Commit inside it, built like the chat's
 * composer: a 36 dp ink pill 8 dp in from the edge, so the field and the button can never differ
 * in height. At the accessibility font sizes Commit goes under the field, the whole width.
 */
@Composable
fun CommitBar(state: GitUiState, reachable: Boolean, onMessage: (String) -> Unit, onCommit: () -> Unit) {
    val canCommit = reachable && state.canCommit
    val stacked = LocalDensity.current.fontScale >= ACCESSIBILITY_FONT_SCALE
    val modifier = Modifier.navigationBarsPadding().imePadding().padding(start = 16.dp, end = 16.dp, bottom = 8.dp)
    if (stacked) {
        Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            GlassSurface(RoundedCornerShape(Radius), Modifier.fillMaxWidth()) {
                MessageField(state.message, onMessage, Modifier.padding(12.dp))
            }
            PrimaryButton(stringResource(R.string.git_commit), onCommit, enabled = canCommit)
        }
    } else {
        GlassSurface(RoundedCornerShape(Radius), modifier.fillMaxWidth()) {
            Row(Modifier.padding(Inset), verticalAlignment = Alignment.Bottom) {
                MessageField(state.message, onMessage, Modifier.weight(1f).heightIn(min = ControlHeight).padding(start = Inset))
                CommitPill(canCommit, state.busy, onCommit)
            }
        }
    }
}

@Composable
private fun MessageField(message: String, onMessage: (String) -> Unit, modifier: Modifier) {
    val placeholder = stringResource(R.string.git_commit_message)
    Box(modifier, contentAlignment = Alignment.CenterStart) {
        if (message.isEmpty()) {
            Text(placeholder, style = WorkspaceType.body, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
        BasicTextField(
            value = message,
            onValueChange = onMessage,
            minLines = 1,
            maxLines = 4,
            textStyle = WorkspaceType.body.copy(color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = placeholder },
        )
    }
}

/** Commit as the composer draws send: ink while there is something to commit, a soft fill while there is not, the orb in its place while it commits. */
@Composable
private fun CommitPill(active: Boolean, committing: Boolean, onCommit: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    val label = stringResource(R.string.git_commit)
    val hint = stringResource(if (active) R.string.git_commit_hint else R.string.git_commit_hint_unstaged)
    Box(
        Modifier
            .height(ControlHeight)
            .clip(CircleShape)
            .background(if (active || committing) colors.primary else colors.surfaceContainerHighest, CircleShape)
            .clickable(enabled = active, role = Role.Button, onClickLabel = label, onClick = onCommit)
            .padding(horizontal = 16.dp)
            .semantics { stateDescription = hint },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            style = WorkspaceType.subheadlineSemibold,
            color = if (active || committing) colors.onPrimary else colors.onSurface.copy(alpha = 0.35f),
            modifier = Modifier.alpha(if (committing) 0f else 1f),
        )
        if (committing) {
            LoadingOrb(state = OrbState.WORKING, theme = if (colors.surface.luminance() < 0.5f) OrbTheme.LIGHT else OrbTheme.DARK, label = stringResource(R.string.git_committing))
        }
    }
}
