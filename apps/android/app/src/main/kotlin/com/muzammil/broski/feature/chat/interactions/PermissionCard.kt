package com.muzammil.broski.feature.chat.interactions

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.IosSwitch
import com.muzammil.broski.design.IosText
import com.muzammil.broski.design.format.FormatRole
import com.muzammil.broski.design.format.FormattedMessage
import com.muzammil.broski.design.format.agentLine
import com.muzammil.broski.design.format.tools.CommandLine
import com.muzammil.broski.design.format.tools.LogLines
import com.muzammil.broski.design.format.tools.ToolArguments
import com.muzammil.broski.design.mono
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.chat.work.FileChangeRow
import uniffi.broski_contract.GrantKind
import uniffi.broski_contract.Interaction
import uniffi.broski_contract.MessagePolicy
import uniffi.broski_contract.PermissionEffect
import uniffi.broski_contract.PermissionGrant
import uniffi.broski_contract.PermissionOption
import uniffi.broski_contract.PermissionPreview
import uniffi.broski_contract.ToolPermissionRequest
import uniffi.broski_core.ClipEnd
import uniffi.broski_core.ToolFacts
import uniffi.broski_core.formatLog
import uniffi.broski_core.toolArguments

/**
 * A tool permission: exactly what the agent wants to do (the command with its arguments and folder
 * in one block, the files with their diffs, the host, the paths), why, and the answers pinned under
 * it: Deny and Allow side by side, the wider allows and Reply beneath. Reply turns the buttons into a
 * field whose words go to the agent with the deny. A deliberate request confirms first.
 */
@Composable
fun PermissionCard(interaction: Interaction, request: ToolPermissionRequest, context: CardContext) {
    val haptics = LocalHapticFeedback.current
    val message = rememberTextFieldState()
    var replying by rememberSaveable(interaction.id) { mutableStateOf(false) }
    val grants = remember(interaction.id) { request.grants.map { it.id }.toMutableStateList() }
    var confirming by remember { mutableStateOf<PermissionOption?>(null) }
    val choose: (PermissionOption) -> Unit = { option ->
        haptics.perform(if (option.effect == PermissionEffect.ALLOW) Haptic.Success else Haptic.Warning)
        context.answer(permissionReply(request, option, if (replying) message.text.toString() else "", grants.toSet()))
    }
    val pick: (PermissionOption) -> Unit = { option -> if (request.deliberate) confirming = option else choose(option) }

    AskBody(
        content = {
            Previews(request, interaction.origin?.toolName, context)
            request.reason?.let { FormattedMessage(it, role = FormatRole.Quiet) }
            request.grants.forEach { grant ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(grantWords(grant), style = IosText.subheadline, modifier = Modifier.weight(1f))
                    IosSwitch(grant.id in grants) { checked -> if (checked) grants += grant.id else grants -= grant.id }
                }
            }
        },
        actions = {
            AnimatedContent(replying, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "permission answers") { reply ->
                val withWords = denyWithWords(request.options)
                if (reply && withWords != null) {
                    AskReplyBar(
                        field = message,
                        placeholder = stringResource(R.string.card_tell_instead, context.agent),
                        sendLabel = stringResource(R.string.card_deny_with_reply),
                        cancelLabel = stringResource(R.string.action_cancel),
                        canSend = context.enabled && canChoose(request, withWords, message.text.toString(), emptySet()),
                        onCancel = { replying = false },
                        onSend = { pick(withWords) },
                    )
                } else {
                    Answers(request, grants.toSet(), context, pick) { replying = true }
                }
            }
        },
    )
    confirming?.let { option ->
        ConfirmOption(option, onConfirm = { confirming = null; choose(option) }, onDismiss = { confirming = null })
    }
}

/** What the card's title says the agent wants: to run, change files, reach a host, use paths, or the ask's own title. */
@Composable
fun permissionTitle(request: ToolPermissionRequest, interaction: Interaction, agent: String): String = when (val first = request.previews.firstOrNull()) {
    is PermissionPreview.Command -> stringResource(R.string.card_wants_to_run, agent)
    is PermissionPreview.FileChanges -> stringResource(R.string.card_wants_to_change, agent)
    is PermissionPreview.Network -> stringResource(R.string.card_wants_to_reach_host, agent, first.v1.host)
    is PermissionPreview.Paths -> stringResource(R.string.card_wants_to_use, agent)
    null -> agentLine(interaction.title)
}

@Composable
private fun ColumnScope.Answers(
    request: ToolPermissionRequest,
    grants: Set<String>,
    context: CardContext,
    pick: (PermissionOption) -> Unit,
    reply: () -> Unit,
) {
    val enabled = { option: PermissionOption -> context.enabled && canChoose(request, option, "", grants) }
    val deny = plainDeny(request.options)
    val allow = primaryAllow(request.options)
    val withWords = denyWithWords(request.options)
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        AskButtons {
            deny?.let {
                AskButton(agentLine(it.label), AskLook.Destructive, context.enabled) { if (it.message == MessagePolicy.REQUIRED) reply() else pick(it) }
            }
            allow?.let { AskButton(agentLine(it.label), AskLook.Primary, enabled(it)) { pick(it) } }
        }
        val links = request.options.filter { it.effect == PermissionEffect.ALLOW && it != allow }
            .map { AskLink(agentLine(it.label), enabled = enabled(it)) { pick(it) } } +
            listOfNotNull(withWords?.let { AskLink(stringResource(R.string.card_reply), stringResource(R.string.card_reply_to, context.agent), context.enabled, reply) })
        if (links.isNotEmpty()) AskLinks(links)
    }
}

@Composable
private fun Previews(request: ToolPermissionRequest, toolName: String?, context: CardContext) {
    val arguments = remember(request.input) { toolArguments(ToolFacts(toolName.orEmpty(), null, request.input, false, emptyList())) }
    request.previews.forEachIndexed { index, preview ->
        val shown = if (index == 0) arguments else emptyList()
        when (preview) {
            is PermissionPreview.Command -> CodeBlock {
                Column(Modifier.heightIn(max = 160.dp).verticalScroll(rememberScrollState())) { CommandLine(preview.v1.command) }
                if (shown.isNotEmpty()) ToolArguments(shown)
                preview.v1.cwd?.let {
                    Text(stringResource(R.string.card_in_folder, it), style = IosText.caption, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.StartEllipsis)
                }
            }
            is PermissionPreview.FileChanges -> {
                Column { preview.v1.changes.forEach { change -> FileChangeRow(change) { context.openDiff(change) } } }
                if (shown.isNotEmpty()) CodeBlock { ToolArguments(shown) }
            }
            is PermissionPreview.Network -> Exact(listOfNotNull(preview.v1.protocol, preview.v1.host).joinToString("://"))
            is PermissionPreview.Paths -> Exact(preview.v1.paths.joinToString("\n"))
        }
    }
    if (request.previews.isEmpty() && arguments.isNotEmpty()) CodeBlock { ToolArguments(arguments) }
}

/** Code on the code background, as one block. */
@Composable
private fun CodeBlock(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer, CodeShape).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

/** What it will reach (hosts, paths), monospaced with its paths and links live, scrolling and never cut. */
@Composable
fun Exact(text: String) {
    val lines = remember(text) { formatLog(text, EXACT_LINES, ClipEnd.HEAD).lines }
    CodeBlock {
        LogLines(
            lines,
            MaterialTheme.typography.bodyMedium.mono(),
            MaterialTheme.colorScheme.onSurface,
            Modifier.heightIn(max = 160.dp).verticalScroll(rememberScrollState()),
        )
    }
}

private val CodeShape = RoundedCornerShape(14.dp)

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
private fun ConfirmOption(option: PermissionOption, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.card_confirm_title, option.label)) },
        text = { Text(stringResource(R.string.card_confirm_body)) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(agentLine(option.label)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}
