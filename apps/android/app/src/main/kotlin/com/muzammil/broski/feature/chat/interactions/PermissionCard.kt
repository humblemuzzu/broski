package com.muzammil.broski.feature.chat.interactions

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.mono
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.chat.work.FileChangeRow
import uniffi.broski_contract.Interaction
import uniffi.broski_contract.PermissionEffect
import uniffi.broski_contract.PermissionOption
import uniffi.broski_contract.PermissionPreview
import uniffi.broski_contract.ToolPermissionRequest

/**
 * "Pi wants to run" and exactly what, scrolling rather than cut; the reason; then the backend's
 * options in its order: the plain allow-once filled, wider allows tonal beside it, and Deny at the
 * end of a field that tells the agent what to do instead. A deliberate ask confirms every option.
 */
@Composable
fun PermissionCard(interaction: Interaction, request: ToolPermissionRequest, context: CardContext) {
    val haptics = LocalHapticFeedback.current
    val message = rememberTextFieldState()
    val grants = remember(interaction.id) { request.grants.map { it.id }.toMutableStateList() }
    var confirming by remember { mutableStateOf<PermissionOption?>(null) }
    val choose: (PermissionOption) -> Unit = { option ->
        haptics.perform(if (option.effect == PermissionEffect.ALLOW) Haptic.Success else Haptic.Warning)
        context.answer(permissionReply(request, option, message.text.toString(), grants.toSet()))
    }
    val pick: (PermissionOption) -> Unit = { option -> if (request.deliberate) confirming = option else choose(option) }

    Text(headline(request, interaction, context.agent), style = MaterialTheme.typography.titleMedium)
    Previews(request, context)
    listOfNotNull(request.reason, interaction.body).forEach { Quiet(it) }
    request.grants.forEach { grant ->
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(grant.id in grants, onCheckedChange = { checked -> if (checked) grants += grant.id else grants -= grant.id })
            Text(listOfNotNull(grant.kind.name.lowercase(), grant.target).joinToString(" "), style = MaterialTheme.typography.bodyMedium.mono())
        }
    }
    if (context.canAnswer) Options(request, message, grants.toSet(), context, pick)
    confirming?.let { option ->
        ConfirmOption(option, onConfirm = { confirming = null; choose(option) }, onDismiss = { confirming = null })
    }
}

@Composable
private fun headline(request: ToolPermissionRequest, interaction: Interaction, agent: String): String = when (request.previews.firstOrNull()) {
    is PermissionPreview.Command -> stringResource(R.string.card_wants_to_run, agent)
    is PermissionPreview.FileChanges -> stringResource(R.string.card_wants_to_change, agent)
    is PermissionPreview.Network -> stringResource(R.string.card_wants_to_reach, agent)
    is PermissionPreview.Paths -> stringResource(R.string.card_wants_to_use, agent)
    null -> stringResource(R.string.card_wants_to_use_tool, agent, interaction.origin?.toolName ?: interaction.title)
}

@Composable
private fun Previews(request: ToolPermissionRequest, context: CardContext) {
    request.previews.forEach { preview ->
        when (preview) {
            is PermissionPreview.Command -> Exact(listOfNotNull(preview.v1.command, preview.v1.cwd?.let { "in $it" }).joinToString("\n"))
            is PermissionPreview.FileChanges -> Column { preview.v1.changes.forEach { change -> FileChangeRow(change) { context.openDiff(change) } } }
            is PermissionPreview.Network -> Exact(listOfNotNull(preview.v1.protocol, preview.v1.host).joinToString("://"))
            is PermissionPreview.Paths -> Exact(preview.v1.paths.joinToString("\n"))
        }
    }
}

/** The agent's own words for what it will do, monospaced, scrolling both ways and never cut. */
@Composable
fun Exact(text: String) {
    Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainerHighest, modifier = Modifier.fillMaxWidth()) {
        SelectionContainer {
            Text(
                text,
                style = MaterialTheme.typography.bodyMedium.mono(),
                softWrap = false,
                modifier = Modifier
                    .heightIn(max = 160.dp)
                    .verticalScroll(rememberScrollState())
                    .horizontalScroll(rememberScrollState())
                    .padding(12.dp),
            )
        }
    }
}

@Composable
private fun Options(
    request: ToolPermissionRequest,
    message: TextFieldState,
    grants: Set<String>,
    context: CardContext,
    pick: (PermissionOption) -> Unit,
) {
    val primary = primaryAllow(request.options)
    val withWords = denyWithWords(request.options)
    val typed = message.text.toString()
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        request.options.filter { it != withWords }.forEach { option ->
            val enabled = context.enabled && canChoose(request, option, typed, grants)
            when {
                option == primary -> Button(onClick = { pick(option) }, enabled = enabled, shapes = ButtonDefaults.shapes()) { Text(option.label) }
                option.effect == PermissionEffect.ALLOW -> FilledTonalButton(onClick = { pick(option) }, enabled = enabled, shapes = ButtonDefaults.shapes()) { Text(option.label) }
                else -> OutlinedButton(onClick = { pick(option) }, enabled = enabled, shapes = ButtonDefaults.shapes()) {
                    Text(option.label, color = if (enabled) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f))
                }
            }
        }
    }
    withWords?.let { deny -> DenyRow(request, deny, message, context, pick) }
}

@Composable
private fun DenyRow(request: ToolPermissionRequest, deny: PermissionOption, message: TextFieldState, context: CardContext, pick: (PermissionOption) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            state = message,
            lineLimits = TextFieldLineLimits.SingleLine,
            placeholder = { Text(stringResource(R.string.card_tell_instead, context.agent)) },
            shape = CircleShape,
            enabled = context.enabled,
            modifier = Modifier.weight(1f),
        )
        TextButton(onClick = { pick(deny) }, enabled = context.enabled && canChoose(request, deny, message.text.toString(), emptySet())) {
            Text(deny.label, color = MaterialTheme.colorScheme.error)
        }
    }
}

@Composable
private fun ConfirmOption(option: PermissionOption, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.card_confirm_title, option.label)) },
        text = { Text(stringResource(R.string.card_confirm_body)) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(option.label) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}
