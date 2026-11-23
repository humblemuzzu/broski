package com.muzammil.broski.feature.chat.interactions

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.muzammil.broski.design.Glass
import com.muzammil.broski.design.GlassSurface
import com.muzammil.broski.design.IosText
import com.muzammil.broski.design.glassShadow
import uniffi.broski_contract.CancelReply
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiMotion
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.Dot
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

/** The ask under the card's header scrolls past 320 dp, or past this share of a short window, so the composer stays in view. */
private val BODY_CAP = 320.dp
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
            Card(first, waiting, context(first), bodyCap = minOf(BODY_CAP, window * MAX_SHARE)) { collapsed = true }
        }
    }
}

/** The ask on the composer's glass, 22 dp round: its micro-label, how many more wait, its menu and a fold-away chevron over the ask itself. */
@Composable
private fun Card(interaction: Interaction, waiting: Int, context: CardContext, bodyCap: Dp, onCollapse: () -> Unit) {
    val shape = RoundedCornerShape(22.dp)
    Box(
        Modifier
            .fillMaxWidth()
            .glassShadow(shape)
            .clip(shape)
            .background(Glass.fill, shape)
            .border(0.5.dp, Glass.edge, shape),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            CardHeader(interaction, waiting, context, onCollapse)
            Column(Modifier.heightIn(max = bodyCap).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                CardBody(interaction, context)
            }
            when {
                !context.canAnswer -> Text(stringResource(R.string.card_answer_on_mac), style = IosText.footnote, color = MaterialTheme.colorScheme.onSurfaceVariant)
                context.state == AnswerState.Stale -> Text(stringResource(R.string.card_answered_elsewhere), style = IosText.footnote, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun CardHeader(interaction: Interaction, waiting: Int, context: CardContext, onCollapse: () -> Unit) {
    val permission = interaction.request is InteractionRequest.ToolPermission
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            microLabel(interaction.request),
            style = TextStyle(fontSize = 11.sp, lineHeight = 13.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.1.sp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (waiting > 1) {
            Text(stringResource(R.string.card_more, waiting - 1), style = IosText.caption, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.weight(1f))
        if (context.canAnswer && !permission) DismissMenu(context)
        HeaderIcon(R.drawable.ic_keyboard_arrow_down, stringResource(R.string.card_collapse), onCollapse)
    }
}

/** Dismissing a question (and, when asked, stopping the run), as the header's menu offers it. */
@Composable
private fun DismissMenu(context: CardContext) {
    var open by remember { mutableStateOf(false) }
    Box {
        HeaderIcon(R.drawable.ic_more_horiz, stringResource(R.string.chat_more)) { open = true }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.card_dismiss)) },
                onClick = {
                    open = false
                    context.answer(InteractionReply.Cancel(CancelReply(stopRun = false, message = null)))
                },
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.card_dismiss_stop), color = MaterialTheme.colorScheme.error) },
                onClick = {
                    open = false
                    context.answer(InteractionReply.Cancel(CancelReply(stopRun = true, message = null)))
                },
            )
        }
    }
}

@Composable
private fun HeaderIcon(icon: Int, label: String, onClick: () -> Unit) {
    Box(
        Modifier.size(28.dp).clickable(role = Role.Button, onClickLabel = label, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(painterResource(icon), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
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
    GlassSurface(CircleShape, Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onExpand)) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            val questions = (interaction.request as? InteractionRequest.Questions)?.v1?.questions?.size
            val words = listOfNotNull(
                kindLabel(interaction.request),
                questions?.takeIf { it > 1 }?.let { pluralStringResource(R.plurals.card_questions, it, it) },
                if (waiting > 1) pluralStringResource(R.plurals.card_more_waiting, waiting - 1, waiting - 1) else null,
            ).joinToString(" · ")
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
private fun microLabel(request: InteractionRequest): String = stringResource(
    when (request) {
        is InteractionRequest.ToolPermission -> R.string.card_label_approval
        is InteractionRequest.PlanApproval -> R.string.card_label_plan
        else -> R.string.card_label_answer
    },
)

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
