package com.muzammil.broski.feature.chat.interactions

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiMotion
import com.muzammil.broski.design.format.FormatRole
import com.muzammil.broski.design.format.FormattedMessage
import com.muzammil.broski.feature.chat.AnswerState
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

/** At most this share of the window goes to a card; past it the card scrolls and the composer stays in view. */
private const val MAX_SHARE = 0.45f

/**
 * The first pending ask, pinned above the composer and never in the transcript, until the bridge
 * says it is resolved. It can fold to a pill so the person reads first; more asks wait behind it.
 */
@Composable
fun InteractionPanel(interactions: List<Interaction>, context: (Interaction) -> CardContext, modifier: Modifier = Modifier) {
    var last by remember { mutableStateOf(interactions) }
    if (interactions.isNotEmpty()) last = interactions
    AnimatedVisibility(
        visible = interactions.isNotEmpty(),
        enter = slideInVertically(BroskiMotion.spring()) { it / 3 } + fadeIn(BroskiMotion.spring()),
        exit = shrinkVertically(BroskiMotion.spring()) + fadeOut(BroskiMotion.spring()),
        modifier = modifier,
    ) {
        last.firstOrNull()?.let { FirstAsk(it, last.size, context) }
    }
}

@Composable
private fun FirstAsk(first: Interaction, waiting: Int, context: (Interaction) -> CardContext) {
    var collapsed by rememberSaveable(first.id) { mutableStateOf(false) }
    AnimatedContent(
        targetState = collapsed,
        transitionSpec = { fadeIn() togetherWith fadeOut() using SizeTransform(clip = false) },
        label = "card",
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    ) { folded ->
        if (folded) {
            Pill(first, waiting) { collapsed = false }
        } else {
            val window = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.height.toDp() }
            Card(first, waiting, context(first), Modifier.heightIn(max = window * MAX_SHARE)) { collapsed = true }
        }
    }
}

@Composable
private fun Card(interaction: Interaction, waiting: Int, context: CardContext, modifier: Modifier, onCollapse: () -> Unit) {
    Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, tonalElevation = 2.dp, modifier = modifier.fillMaxWidth()) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    kindLabel(interaction.request).uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.weight(1f),
                )
                if (waiting > 1) {
                    Text(pluralStringResource(R.plurals.card_more_waiting, waiting - 1, waiting - 1), style = MaterialTheme.typography.labelSmall)
                }
                IconButton(onClick = onCollapse) {
                    Icon(painterResource(R.drawable.ic_keyboard_arrow_down), contentDescription = stringResource(R.string.card_collapse))
                }
            }
            Column(Modifier.padding(end = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                CardBody(interaction, context)
                when {
                    !context.canAnswer -> Quiet(stringResource(R.string.card_answer_on_mac))
                    context.state == AnswerState.Stale -> Quiet(stringResource(R.string.card_answered_elsewhere))
                }
            }
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
        is InteractionRequest.Choice -> ChoiceCard(interaction, request.v1, context)
        is InteractionRequest.Confirm -> ConfirmCard(interaction, request.v1, context)
        is InteractionRequest.Text -> TextCard(interaction, request.v1, context)
    }
}

@Composable
private fun Pill(interaction: Interaction, waiting: Int, onExpand: () -> Unit) {
    Surface(onClick = onExpand, shape = CircleShape, color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            val questions = (interaction.request as? InteractionRequest.Questions)?.v1?.questions?.size
            val words = listOfNotNull(
                kindLabel(interaction.request),
                questions?.takeIf { it > 1 }?.let { pluralStringResource(R.plurals.card_questions, it, it) },
                if (waiting > 1) pluralStringResource(R.plurals.card_more_waiting, waiting - 1, waiting - 1) else null,
            ).joinToString(" · ")
            Text(words, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
            Icon(painterResource(R.drawable.ic_keyboard_arrow_up), contentDescription = stringResource(R.string.card_expand), Modifier.size(20.dp))
        }
    }
}

@Composable
private fun kindLabel(request: InteractionRequest): String = stringResource(
    when (request) {
        is InteractionRequest.ToolPermission -> R.string.card_needs_approval
        is InteractionRequest.PlanApproval -> R.string.card_needs_plan
        else -> R.string.card_needs_answer
    },
)

/** A card's quieter words, the agent's or ours, through the formatter. */
@Composable
fun Quiet(text: String) {
    FormattedMessage(text, role = FormatRole.Quiet)
}
