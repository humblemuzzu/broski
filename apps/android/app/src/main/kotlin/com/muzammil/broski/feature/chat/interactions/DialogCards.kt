package com.muzammil.broski.feature.chat.interactions

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.IosText
import com.muzammil.broski.design.format.FormattedText
import com.muzammil.broski.design.format.agentLine
import com.muzammil.broski.design.perform
import uniffi.broski_contract.ChoiceRequest
import uniffi.broski_contract.ConfirmRequest
import uniffi.broski_contract.Interaction
import uniffi.broski_contract.PlanApprovalRequest
import uniffi.broski_contract.TextRequest

/**
 * The plan, the mode to go on in when it offers one, then Reject and Approve pinned under it, and
 * Suggest Changes, which sends the person's note with the rejection.
 */
@Composable
fun PlanCard(interaction: Interaction, request: PlanApprovalRequest, context: CardContext) {
    val haptics = LocalHapticFeedback.current
    var modeAfter by rememberSaveable(interaction.id) { mutableStateOf(request.modeOptions?.defaultValue) }
    var replying by rememberSaveable(interaction.id) { mutableStateOf(false) }
    val feedback = rememberTextFieldState()
    val reject = { note: String ->
        haptics.perform(Haptic.Warning)
        context.answer(planReply(approve = false, feedback = note, modeAfter = null))
    }
    AskBody(
        content = {
            FormattedText(request.plan)
            request.modeOptions?.let { modes ->
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    modes.options.forEach { option ->
                        FilterChip(selected = option.value == modeAfter, onClick = { modeAfter = option.value }, enabled = context.enabled, label = { Text(agentLine(option.label)) })
                    }
                }
            }
        },
        actions = {
            AnimatedContent(replying, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "plan answers") { reply ->
                if (reply) {
                    AskReplyBar(
                        field = feedback,
                        placeholder = stringResource(R.string.card_plan_feedback),
                        sendLabel = stringResource(R.string.card_plan_reject_with_note),
                        cancelLabel = stringResource(R.string.action_cancel),
                        canSend = context.enabled,
                        onCancel = { replying = false },
                        onSend = { reject(feedback.text.toString()) },
                    )
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        AskButtons {
                            AskButton(stringResource(R.string.card_plan_reject), AskLook.Destructive, context.enabled) { reject("") }
                            AskButton(stringResource(R.string.card_plan_approve), AskLook.Primary, context.enabled) {
                                haptics.perform(Haptic.Success)
                                context.answer(planReply(approve = true, feedback = "", modeAfter = modeAfter))
                            }
                        }
                        AskLinks(listOf(AskLink(stringResource(R.string.card_plan_suggest), enabled = context.enabled) { replying = true }))
                    }
                }
            }
        },
    )
}

/** A Pi dialog's choice: each option a full-width button, the tap the answer. */
@Composable
fun ChoiceCard(request: ChoiceRequest, context: CardContext) {
    val haptics = LocalHapticFeedback.current
    AskBody(
        content = {
            request.options.forEach { option ->
                AskButtons {
                    AskButton(agentLine(option.label), AskLook.Secondary, context.enabled) {
                        haptics.perform(Haptic.Success)
                        context.answer(choiceReply(option.value))
                    }
                }
                option.description?.let { Quiet(it) }
            }
        },
        actions = {},
    )
}

@Composable
fun ConfirmCard(request: ConfirmRequest, context: CardContext) {
    val haptics = LocalHapticFeedback.current
    val url = request.url
    AskBody(
        content = { if (url != null) LinkButton(url) },
        actions = {
            AskButtons {
                AskButton(stringResource(if (url != null) R.string.card_decline else R.string.card_no), AskLook.Secondary, context.enabled) {
                    haptics.perform(Haptic.Warning)
                    context.answer(confirmReply(false))
                }
                AskButton(stringResource(if (url != null) R.string.card_done else R.string.card_yes), AskLook.Primary, context.enabled) {
                    haptics.perform(Haptic.Success)
                    context.answer(confirmReply(true))
                }
            }
        },
    )
}

/** The page to visit before answering, by its host, so the person sees where it goes before it opens. */
@Composable
private fun LinkButton(url: String) {
    val uris = LocalUriHandler.current
    AskButtons {
        AskButton(stringResource(R.string.card_open_link, url.toUri().host ?: url), AskLook.Secondary) { uris.openUri(url) }
    }
}

@Composable
fun TextCard(request: TextRequest, context: CardContext) {
    val haptics = LocalHapticFeedback.current
    val field = rememberTextFieldState(request.initialText.orEmpty())
    val hint = request.placeholder ?: stringResource(R.string.card_your_answer)
    AskBody(
        content = {
            BasicTextField(
                state = field,
                enabled = context.enabled,
                lineLimits = if (request.multiline) TextFieldLineLimits.MultiLine(2, 8) else TextFieldLineLimits.SingleLine,
                textStyle = IosText.body.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                modifier = Modifier.askField(hint),
                decorator = { inner -> FieldHint(field.text.isEmpty(), hint, inner) },
            )
        },
        actions = {
            AskButtons {
                AskButton(stringResource(R.string.card_send), AskLook.Primary, context.enabled) {
                    haptics.perform(Haptic.Success)
                    context.answer(textReply(field.text.toString()))
                }
            }
        },
    )
}
