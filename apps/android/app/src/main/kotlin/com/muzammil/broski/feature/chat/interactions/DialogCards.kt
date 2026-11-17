package com.muzammil.broski.feature.chat.interactions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.core.net.toUri
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.format.FormattedText
import com.muzammil.broski.design.perform
import com.muzammil.broski.design.format.agentLine
import uniffi.broski_contract.ChoiceRequest
import uniffi.broski_contract.ConfirmRequest
import uniffi.broski_contract.Interaction
import uniffi.broski_contract.PlanApprovalRequest
import uniffi.broski_contract.TextRequest

/** The plan, the mode to go on in when it offers one, then Approve or Reject with why. */
@Composable
fun PlanCard(interaction: Interaction, request: PlanApprovalRequest, context: CardContext) {
    val haptics = LocalHapticFeedback.current
    var modeAfter by rememberSaveable(interaction.id) { mutableStateOf(request.modeOptions?.defaultValue) }
    val feedback = rememberTextFieldState()
    Text(agentLine(interaction.title), style = MaterialTheme.typography.titleMedium)
    FormattedText(request.plan)
    request.modeOptions?.let { modes ->
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            modes.options.forEach { option ->
                FilterChip(selected = option.value == modeAfter, onClick = { modeAfter = option.value }, enabled = context.enabled, label = { Text(agentLine(option.label)) })
            }
        }
    }
    OutlinedTextField(
        state = feedback,
        label = { Text(stringResource(R.string.card_plan_feedback)) },
        enabled = context.enabled,
        lineLimits = TextFieldLineLimits.MultiLine(1, 4),
        modifier = Modifier.fillMaxWidth(),
    )
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(
            onClick = {
                haptics.perform(Haptic.Success)
                context.answer(planReply(approve = true, feedback = "", modeAfter = modeAfter))
            },
            enabled = context.enabled,
            shapes = ButtonDefaults.shapes(),
        ) { Text(stringResource(R.string.card_plan_approve)) }
        FilledTonalButton(
            onClick = {
                haptics.perform(Haptic.Warning)
                context.answer(planReply(approve = false, feedback = feedback.text.toString(), modeAfter = null))
            },
            enabled = context.enabled,
            shapes = ButtonDefaults.shapes(),
        ) { Text(stringResource(R.string.card_plan_reject)) }
    }
}

/** A Pi dialog's choice: each option a button, the tap the answer. */
@Composable
fun ChoiceCard(interaction: Interaction, request: ChoiceRequest, context: CardContext) {
    val haptics = LocalHapticFeedback.current
    Text(agentLine(interaction.title), style = MaterialTheme.typography.titleMedium)
    interaction.body?.let { Quiet(it) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        request.options.forEach { option ->
            FilledTonalButton(
                onClick = {
                    haptics.perform(Haptic.Success)
                    context.answer(choiceReply(option.value))
                },
                enabled = context.enabled,
                shapes = ButtonDefaults.shapes(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text(agentLine(option.label)) }
            option.description?.let { Quiet(it) }
        }
    }
    TextButton(onClick = { context.answer(dismissReply()) }, enabled = context.enabled) { Text(stringResource(R.string.card_dismiss)) }
}

@Composable
fun ConfirmCard(interaction: Interaction, request: ConfirmRequest, context: CardContext) {
    val haptics = LocalHapticFeedback.current
    val url = request.url
    Text(agentLine(interaction.title), style = MaterialTheme.typography.titleMedium)
    interaction.body?.let { Quiet(it) }
    if (url != null) LinkButton(url)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = { haptics.perform(Haptic.Success); context.answer(confirmReply(true)) }, enabled = context.enabled, shapes = ButtonDefaults.shapes()) {
            Text(stringResource(if (url != null) R.string.card_done else R.string.card_yes))
        }
        FilledTonalButton(onClick = { haptics.perform(Haptic.Warning); context.answer(confirmReply(false)) }, enabled = context.enabled, shapes = ButtonDefaults.shapes()) {
            Text(stringResource(if (url != null) R.string.card_decline else R.string.card_no))
        }
    }
}

/** The page to visit before answering, by its host, so the person sees where it goes before it opens. */
@Composable
private fun LinkButton(url: String) {
    val uris = LocalUriHandler.current
    OutlinedButton(onClick = { uris.openUri(url) }, shapes = ButtonDefaults.shapes(), modifier = Modifier.fillMaxWidth()) {
        Icon(painterResource(R.drawable.ic_open_in_new), contentDescription = null, modifier = Modifier.size(16.dp))
        Text(stringResource(R.string.card_open_link, url.toUri().host ?: url), modifier = Modifier.padding(start = 8.dp))
    }
}

@Composable
fun TextCard(interaction: Interaction, request: TextRequest, context: CardContext) {
    val haptics = LocalHapticFeedback.current
    val field = rememberTextFieldState(request.initialText.orEmpty())
    Text(agentLine(interaction.title), style = MaterialTheme.typography.titleMedium)
    interaction.body?.let { Quiet(it) }
    OutlinedTextField(
        state = field,
        placeholder = request.placeholder?.let { { Text(it) } },
        enabled = context.enabled,
        lineLimits = if (request.multiline) TextFieldLineLimits.MultiLine(2, 6) else TextFieldLineLimits.SingleLine,
        modifier = Modifier.fillMaxWidth(),
    )
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Button(
            onClick = {
                haptics.perform(Haptic.Success)
                context.answer(textReply(field.text.toString()))
            },
            enabled = context.enabled,
            shapes = ButtonDefaults.shapes(),
        ) { Text(stringResource(R.string.card_submit)) }
        TextButton(onClick = { context.answer(dismissReply()) }, enabled = context.enabled) { Text(stringResource(R.string.card_dismiss)) }
    }
}
