package com.muzammil.broski.feature.chat.interactions

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.design.GlassButton
import com.muzammil.broski.design.IosText
import com.muzammil.broski.design.IosSwitch
import uniffi.broski_contract.GrantKind
import uniffi.broski_contract.PermissionGrant
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.format.FormatRole
import com.muzammil.broski.design.format.FormattedMessage
import com.muzammil.broski.design.format.tools.CommandLine
import com.muzammil.broski.design.format.tools.LogLines
import com.muzammil.broski.design.format.tools.ToolArguments
import com.muzammil.broski.design.mono
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.chat.work.FileChangeRow
import com.muzammil.broski.design.format.agentLine
import uniffi.broski_contract.Interaction
import uniffi.broski_contract.PermissionEffect
import uniffi.broski_contract.PermissionOption
import uniffi.broski_contract.PermissionPreview
import uniffi.broski_contract.ToolPermissionRequest
import uniffi.broski_core.ClipEnd
import uniffi.broski_core.ToolFacts
import uniffi.broski_core.formatLog
import uniffi.broski_core.toolArguments

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

    Text(headline(request, interaction, context.agent), style = IosText.body.copy(fontWeight = FontWeight.SemiBold))
    Previews(request, context)
    val arguments = remember(request.input) { toolArguments(ToolFacts(interaction.origin?.toolName.orEmpty(), null, request.input, false, emptyList())) }
    if (arguments.isNotEmpty()) {
        Surface(shape = CodeShape, color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
            ToolArguments(arguments, Modifier.padding(12.dp))
        }
    }
    (request.reason ?: interaction.body)?.let { FormattedMessage(it, role = FormatRole.Quiet) }
    request.grants.forEach { grant ->
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(grantWords(grant), style = IosText.subheadline, modifier = Modifier.weight(1f))
            IosSwitch(grant.id in grants) { checked -> if (checked) grants += grant.id else grants -= grant.id }
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
    null -> agentLine(interaction.title)
}

@Composable
private fun Previews(request: ToolPermissionRequest, context: CardContext) {
    request.previews.forEach { preview ->
        when (preview) {
            is PermissionPreview.Command -> Surface(shape = CodeShape, color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Column(Modifier.heightIn(max = 160.dp).verticalScroll(rememberScrollState())) { CommandLine(preview.v1.command) }
                    preview.v1.cwd?.let {
                        Text(stringResource(R.string.card_in_folder, it), style = IosText.caption, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.StartEllipsis)
                    }
                }
            }
            is PermissionPreview.FileChanges -> Column { preview.v1.changes.forEach { change -> FileChangeRow(change) { context.openDiff(change) } } }
            is PermissionPreview.Network -> Exact(listOfNotNull(preview.v1.protocol, preview.v1.host).joinToString("://"))
            is PermissionPreview.Paths -> Exact(preview.v1.paths.joinToString("\n"))
        }
    }
}

/** What it will reach (hosts, paths), monospaced with its paths and links live, scrolling and never cut. */
@Composable
fun Exact(text: String) {
    val lines = remember(text) { formatLog(text, EXACT_LINES, ClipEnd.HEAD).lines }
    Surface(shape = CodeShape, color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        LogLines(
            lines,
            MaterialTheme.typography.bodyMedium.mono(),
            MaterialTheme.colorScheme.onSurface,
            Modifier.heightIn(max = 160.dp).verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).padding(12.dp),
        )
    }
}

private val CodeShape = RoundedCornerShape(12.dp)

@Composable
private fun grantWords(grant: PermissionGrant): String {
    val target = grant.target?.let { " $it" }.orEmpty()
    return stringResource(
        when (grant.kind) {
            GrantKind.NETWORK -> R.string.card_grant_network
            GrantKind.READ -> R.string.card_grant_read
            GrantKind.WRITE -> R.string.card_grant_write
            GrantKind.DENY -> R.string.card_grant_deny
        },
    ) + target
}

/** Lines of what a permission reaches, shown whole up to this. */
private const val EXACT_LINES = 2_000u

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
    val enabled = { option: PermissionOption -> context.enabled && canChoose(request, option, typed, grants) }
    val otherAllows = request.options.filter { it.effect == PermissionEffect.ALLOW && it != primary }
    val otherDenies = request.options.filter { it.effect != PermissionEffect.ALLOW && it != withWords }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        primary?.let { GlassButton(agentLine(it.label), { pick(it) }, prominent = true, enabled = enabled(it), height = 50.dp) }
        if (otherAllows.isNotEmpty()) {
            SideBySide(otherAllows.size) { option ->
                val it = otherAllows[option]
                GlassButton(agentLine(it.label), { pick(it) }, enabled = enabled(it), height = 44.dp)
            }
        }
        withWords?.let { deny -> DenyRow(deny, message, context, enabled(deny), pick) }
        otherDenies.forEach { option ->
            TextButton(onClick = { pick(option) }, enabled = enabled(option), modifier = Modifier.fillMaxWidth()) {
                Text(agentLine(option.label), style = IosText.subheadline.copy(fontWeight = FontWeight.SemiBold), color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

/** [count] buttons in one row when each fits its share, else one under another, as iOS's `ViewThatFits`. */
@Composable
private fun SideBySide(count: Int, button: @Composable (Int) -> Unit) {
    SubcomposeLayout { constraints ->
        val gap = 8.dp.roundToPx()
        val share = ((constraints.maxWidth - gap * (count - 1)) / count).coerceAtLeast(0)
        val natural = subcompose("natural") { repeat(count) { Box { button(it) } } }
            .map { it.maxIntrinsicWidth(constraints.maxHeight) }
        val fits = natural.all { it <= share }
        val loose = constraints.copy(minWidth = 0)
        val placeables = subcompose("shown") { repeat(count) { button(it) } }
            .map { it.measure(if (fits) loose.copy(maxWidth = share) else loose) }
        val height = if (fits) placeables.maxOf { it.height } else placeables.sumOf { it.height } + gap * (count - 1)
        layout(constraints.maxWidth, height) {
            var at = 0
            placeables.forEach {
                if (fits) it.place(at, 0) else it.place(0, at)
                at += (if (fits) it.width else it.height) + gap
            }
        }
    }
}

@Composable
private fun DenyRow(deny: PermissionOption, message: TextFieldState, context: CardContext, enabled: Boolean, pick: (PermissionOption) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        BasicTextField(
            state = message,
            lineLimits = TextFieldLineLimits.MultiLine(minHeightInLines = 1, maxHeightInLines = 3),
            enabled = context.enabled,
            textStyle = IosText.subheadline.copy(color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            modifier = Modifier
                .weight(1f)
                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f), RoundedCornerShape(18.dp))
                .padding(horizontal = 12.dp, vertical = 10.dp),
            decorator = { field ->
                Box {
                    if (message.text.isEmpty()) {
                        Text(stringResource(R.string.card_tell_instead, context.agent), style = IosText.subheadline, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    field()
                }
            },
        )
        GlassButton(agentLine(deny.label), { pick(deny) }, tint = MaterialTheme.colorScheme.error, enabled = enabled, wide = false, height = 40.dp)
    }
}

@Composable
private fun ConfirmOption(option: PermissionOption, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.card_confirm_title, option.label)) },
        text = { Text(stringResource(R.string.card_confirm_body)) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(agentLine(option.label)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}
