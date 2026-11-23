package com.muzammil.broski.feature.chat.interactions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicSecureTextField
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.clearText
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import com.muzammil.broski.design.IosText
import com.muzammil.broski.feature.usage.Segments
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.format.FormattedMessage
import com.muzammil.broski.design.perform
import com.muzammil.broski.design.format.agentLine
import uniffi.broski_contract.Interaction
import uniffi.broski_contract.Question
import uniffi.broski_contract.QuestionsRequest

/**
 * The agent's questions, one tab each when there are several: options as full-width rows with their
 * hints, the person's own answer, a secret masked; Send pinned under them.
 */
@Composable
fun QuestionsCard(interaction: Interaction, request: QuestionsRequest, context: CardContext) {
    val haptics = LocalHapticFeedback.current
    val drafts = remember(interaction.id) { mutableStateMapOf<String, QuestionDraft>() }
    var tab by rememberSaveable(interaction.id) { mutableIntStateOf(0) }
    AskBody(
        content = {
            if (request.questions.size > 1) {
                Segments(
                    request.questions.indices.toList(),
                    tab,
                    label = { index -> agentLine(request.questions[index].header.orEmpty()).ifEmpty { null } ?: stringResource(R.string.card_question_number, index + 1) },
                    onSelect = { tab = it },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            val question = request.questions[tab.coerceIn(request.questions.indices)]
            key(question.id) {
                QuestionView(question, drafts[question.id] ?: QuestionDraft(), context.enabled) {
                    if (it.selected != drafts[question.id]?.selected) haptics.perform(Haptic.PickerStep)
                    drafts[question.id] = it
                }
            }
        },
        actions = {
            AskButtons {
                AskButton(
                    stringResource(if (request.questions.size > 1) R.string.card_send_answers else R.string.card_send_answer),
                    AskLook.Primary,
                    context.enabled && questionsComplete(request.questions, drafts),
                ) {
                    haptics.perform(Haptic.Success)
                    context.answer(questionsReply(request.questions, drafts))
                }
            }
        },
    )
}

@Composable
private fun QuestionView(question: Question, draft: QuestionDraft, enabled: Boolean, onChange: (QuestionDraft) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        FormattedMessage(question.text)
        if (question.options.isNotEmpty()) {
            Text(
                stringResource(if (question.multiSelect) R.string.card_pick_any else R.string.card_pick_one),
                style = IosText.footnote,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.05f), RoundedCornerShape(18.dp))) {
                question.options.forEachIndexed { index, option ->
                    if (index > 0) HorizontalDivider(Modifier.padding(start = 48.dp), thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant)
                    val picked = option.label in draft.selected
                    val toggle = {
                        val selected = when {
                            question.multiSelect -> if (picked) draft.selected - option.label else draft.selected + option.label
                            else -> setOf(option.label)
                        }
                        onChange(draft.copy(selected = selected, custom = if (question.multiSelect) draft.custom else ""))
                    }
                    OptionRow(agentLine(option.label), option.description, picked, question.multiSelect, enabled, toggle)
                }
            }
        }
        if (question.allowCustom) CustomAnswer(question, draft, enabled, onChange)
    }
}

@Composable
private fun OptionRow(label: String, description: String?, picked: Boolean, multi: Boolean, enabled: Boolean, onToggle: () -> Unit) {
    val rowModifier = if (multi) {
        Modifier.toggleable(picked, enabled = enabled, role = Role.Checkbox) { onToggle() }
    } else {
        Modifier.selectable(picked, enabled = enabled, role = Role.RadioButton, onClick = onToggle)
    }
    Row(
        rowModifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            painterResource(pickIcon(picked, multi)),
            contentDescription = null,
            tint = if (picked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(24.dp),
        )
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = IosText.body.copy(fontWeight = FontWeight.Medium))
            description?.let { Quiet(it) }
        }
    }
}

@Composable
private fun CustomAnswer(question: Question, draft: QuestionDraft, enabled: Boolean, onChange: (QuestionDraft) -> Unit) {
    val field = rememberTextFieldState(draft.custom)
    val current by rememberUpdatedState(draft)
    val change by rememberUpdatedState(onChange)
    LaunchedEffect(field) {
        snapshotFlow { field.text.toString() }.collect { typed ->
            val before = current
            if (typed != before.custom) {
                change(before.copy(custom = typed, selected = if (question.multiSelect || typed.isEmpty()) before.selected else emptySet()))
            }
        }
    }
    LaunchedEffect(draft.custom) {
        if (draft.custom.isEmpty() && field.text.isNotEmpty()) field.clearText()
    }
    val label = stringResource(
        when {
            question.secret -> R.string.card_secret_answer
            question.options.isEmpty() -> R.string.card_your_answer
            else -> R.string.card_own_answer
        },
    )
    if (question.secret) {
        BasicSecureTextField(
            state = field,
            enabled = enabled,
            textStyle = IosText.body.copy(color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            modifier = Modifier.askField(label),
            decorator = { inner -> FieldHint(field.text.isEmpty(), label, inner) },
        )
    } else {
        BasicTextField(
            state = field,
            enabled = enabled,
            lineLimits = TextFieldLineLimits.MultiLine(1, 4),
            textStyle = IosText.body.copy(color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            modifier = Modifier.askField(label),
            decorator = { inner -> FieldHint(field.text.isEmpty(), label, inner) },
        )
    }
}

private fun pickIcon(picked: Boolean, multi: Boolean): Int = when {
    multi && picked -> R.drawable.ic_check_box
    multi -> R.drawable.ic_check_box_outline_blank
    picked -> R.drawable.ic_radio_button_checked
    else -> R.drawable.ic_radio_button_unchecked
}
