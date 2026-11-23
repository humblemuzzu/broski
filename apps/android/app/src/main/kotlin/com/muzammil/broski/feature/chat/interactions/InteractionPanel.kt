package com.muzammil.broski.feature.chat.interactions

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.Dot
import com.muzammil.broski.design.Glass
import com.muzammil.broski.design.GlassSurface
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.IosText
import com.muzammil.broski.design.format.agentLine
import com.muzammil.broski.design.glassShadow
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.chat.AnswerState
import uniffi.broski_contract.CancelReply
import uniffi.broski_contract.FileChange
import uniffi.broski_contract.Interaction
import uniffi.broski_contract.InteractionReply
import uniffi.broski_contract.InteractionRequest

/** What a card needs besides its interaction: who asks, whether it can be answered here, and where answers go. */
@Immutable
class CardContext(
    val agent: String,
    val canAnswer: Boolean,
    val state: AnswerState?,
    val answer: (InteractionReply) -> Unit,
    val openDiff: (FileChange) -> Unit,
) {
    val sending: Boolean get() = state == AnswerState.Sending
    val enabled: Boolean get() = canAnswer && state == null
}

/**
 * The first pending ask, in place of the composer and never in the transcript, until the bridge says
 * it is resolved: what the agent wants as its title, the ask scrolling under it, and the answers
 * pinned at the bottom where the thumb is. Folding it gives the composer back under a pill.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun InteractionPanel(interaction: Interaction, waiting: Int, context: CardContext, onFold: () -> Unit, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(28.dp)
    val keyboardUp = WindowInsets.isImeVisible
    Column(
        modifier
            .fillMaxWidth()
            .glassShadow(shape)
            .clip(shape)
            .background(Glass.fill, shape)
            .border(0.5.dp, Glass.edge, shape)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Header(interaction, waiting, context, onFold)
        if (context.canAnswer) {
            CompositionLocalProvider(
                LocalAskCap provides if (keyboardUp) 150.dp else 320.dp,
                LocalAskIntro provides interaction.body.takeIf { interaction.request !is InteractionRequest.ToolPermission }?.let { agentLine(it) },
            ) { CardBody(interaction, context) }
        } else {
            Text(stringResource(R.string.card_answer_on_mac), style = IosText.footnote, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (context.state == AnswerState.Stale) {
            Text(stringResource(R.string.card_answered_elsewhere), style = IosText.footnote, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun Header(interaction: Interaction, waiting: Int, context: CardContext, onFold: () -> Unit) {
    val keyboard = LocalSoftwareKeyboardController.current
    val kind = kindWords(interaction.request)
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Column(
            Modifier
                .weight(1f)
                .padding(top = 4.dp)
                .clickable(remember { MutableInteractionSource() }, indication = null) { keyboard?.hide() },
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                askTitle(interaction, context.agent),
                style = IosText.body.copy(fontWeight = FontWeight.SemiBold),
                maxLines = 2,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                if (waiting > 1) stringResource(R.string.card_kind_more, kind, waiting - 1) else kind,
                style = IosText.footnote,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        val items = menuItems(interaction)
        if (context.canAnswer && items.isNotEmpty()) Menu(items, context)
        HeaderButton(R.drawable.ic_keyboard_arrow_down, stringResource(R.string.card_collapse), onFold)
    }
}

@Composable
private fun askTitle(interaction: Interaction, agent: String): String = when (val request = interaction.request) {
    is InteractionRequest.ToolPermission -> permissionTitle(request.v1, interaction, agent)
    else -> agentLine(interaction.title)
}

@Composable
private fun kindWords(request: InteractionRequest): String = when {
    request is InteractionRequest.ToolPermission -> stringResource(R.string.card_needs_approval)
    request is InteractionRequest.PlanApproval -> stringResource(R.string.card_kind_plan)
    request is InteractionRequest.Questions && request.v1.questions.size > 1 ->
        pluralStringResource(R.plurals.card_questions, request.v1.questions.size, request.v1.questions.size)
    else -> stringResource(R.string.card_needs_answer)
}

private class MenuItem(val label: String, val destructive: Boolean, val reply: InteractionReply)

@Composable
private fun menuItems(interaction: Interaction): List<MenuItem> = when (val request = interaction.request) {
    is InteractionRequest.ToolPermission -> menuDenies(request.v1.options).map {
        MenuItem(agentLine(it.label), true, permissionReply(request.v1, it, "", emptySet()))
    }
    else -> listOf(
        MenuItem(stringResource(R.string.card_dismiss), false, InteractionReply.Cancel(CancelReply(stopRun = false, message = null))),
        MenuItem(stringResource(R.string.card_dismiss_stop), true, InteractionReply.Cancel(CancelReply(stopRun = true, message = null))),
    )
}

@Composable
private fun Menu(items: List<MenuItem>, context: CardContext) {
    val haptics = LocalHapticFeedback.current
    var open by remember { mutableStateOf(false) }
    Box {
        HeaderButton(R.drawable.ic_more_horiz, stringResource(R.string.chat_more)) { open = true }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            items.forEach { item ->
                DropdownMenuItem(
                    text = { Text(item.label, color = if (item.destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface) },
                    enabled = context.enabled,
                    onClick = {
                        open = false
                        haptics.perform(Haptic.Warning)
                        context.answer(item.reply)
                    },
                )
            }
        }
    }
}

/** A round 32 dp control in the card's top corner, inside a 44 dp target: fold it away, or its menu. */
@Composable
private fun HeaderButton(icon: Int, label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .size(44.dp)
            .clickable(remember { MutableInteractionSource() }, indication = null, role = Role.Button, onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(32.dp).background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f), CircleShape), contentAlignment = Alignment.Center) {
            Icon(painterResource(icon), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun CardBody(interaction: Interaction, context: CardContext) {
    when (val request = interaction.request) {
        is InteractionRequest.ToolPermission -> PermissionCard(interaction, request.v1, context)
        is InteractionRequest.Questions -> QuestionsCard(interaction, request.v1, context)
        is InteractionRequest.Form -> FormCard(interaction, request.v1, context)
        is InteractionRequest.PlanApproval -> PlanCard(interaction, request.v1, context)
        is InteractionRequest.Choice -> ChoiceCard(request.v1, context)
        is InteractionRequest.Confirm -> ConfirmCard(request.v1, context)
        is InteractionRequest.Text -> TextCard(request.v1, context)
    }
}

/** The ask folded away: a pill over the composer that brings it back. */
@Composable
fun AskPill(interaction: Interaction, waiting: Int, onOpen: () -> Unit) {
    GlassSurface(CircleShape, Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onOpen)) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            val questions = (interaction.request as? InteractionRequest.Questions)?.v1?.questions?.size
            val words = listOfNotNull(
                pillWords(interaction.request),
                questions?.takeIf { it > 1 }?.let { pluralStringResource(R.plurals.card_questions, it, it) },
                if (waiting > 1) pluralStringResource(R.plurals.card_more_waiting, waiting - 1, waiting - 1) else null,
            ).joinToString(" \u00b7 ")
            Dot(BroskiTheme.semantic.needsYou, Modifier.padding(end = 8.dp))
            Text(words, style = IosText.subheadline.copy(fontWeight = FontWeight.SemiBold), modifier = Modifier.weight(1f))
            Icon(
                painterResource(R.drawable.ic_keyboard_arrow_up),
                contentDescription = stringResource(R.string.card_expand),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

@Composable
private fun pillWords(request: InteractionRequest): String = stringResource(
    when (request) {
        is InteractionRequest.ToolPermission -> R.string.card_needs_approval
        is InteractionRequest.PlanApproval -> R.string.card_needs_plan
        else -> R.string.card_needs_answer
    },
)
