package com.muzammil.broski.feature.chat.interactions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.clearText
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedSecureTextField
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import uniffi.broski_contract.Interaction
import uniffi.broski_contract.Question
import uniffi.broski_contract.QuestionsRequest

/** The agent's questions, one tab each when there are several: options with their hints, the person's own answer, a secret masked. */
@Composable
fun QuestionsCard(interaction: Interaction, request: QuestionsRequest, context: CardContext) {
    val haptics = LocalHapticFeedback.current
    val drafts = remember(interaction.id) { mutableStateMapOf<String, QuestionDraft>() }
    var tab by rememberSaveable(interaction.id) { mutableIntStateOf(0) }
    Text(interaction.title, style = MaterialTheme.typography.titleMedium)
    if (request.questions.size > 1) {
        PrimaryScrollableTabRow(selectedTabIndex = tab, edgePadding = 0.dp) {
            request.questions.forEachIndexed { index, question ->
                Tab(selected = tab == index, onClick = { tab = index }, text = { Text(question.header ?: stringResource(R.string.card_question_number, index + 1)) })
            }
        }
    }
    val question = request.questions[tab.coerceIn(request.questions.indices)]
    key(question.id) {
        QuestionView(question, drafts[question.id] ?: QuestionDraft(), context.enabled) { drafts[question.id] = it }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Button(
            onClick = {
                haptics.perform(Haptic.Success)
                context.answer(questionsReply(request.questions, drafts))
            },
            enabled = context.enabled && questionsComplete(request.questions, drafts),
            shapes = ButtonDefaults.shapes(),
        ) { Text(stringResource(R.string.card_submit)) }
        TextButton(onClick = { context.answer(dismissReply()) }, enabled = context.enabled) { Text(stringResource(R.string.card_dismiss)) }
    }
}

@Composable
private fun QuestionView(question: Question, draft: QuestionDraft, enabled: Boolean, onChange: (QuestionDraft) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(question.text, style = MaterialTheme.typography.bodyLarge)
        if (question.options.isNotEmpty()) {
            Text(
                stringResource(if (question.multiSelect) R.string.card_pick_any else R.string.card_pick_one),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        question.options.forEach { option ->
            val picked = option.label in draft.selected
            val toggle = {
                val selected = when {
                    question.multiSelect -> if (picked) draft.selected - option.label else draft.selected + option.label
                    else -> setOf(option.label)
                }
                onChange(draft.copy(selected = selected, custom = if (question.multiSelect) draft.custom else ""))
            }
            OptionRow(option.label, option.description, picked, question.multiSelect, enabled, toggle)
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
    Row(rowModifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        if (multi) Checkbox(picked, onCheckedChange = null, enabled = enabled) else RadioButton(picked, onClick = null, enabled = enabled)
        Column(Modifier.padding(start = 12.dp)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
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
    val label = stringResource(if (question.secret) R.string.card_secret_answer else R.string.card_own_answer)
    if (question.secret) {
        OutlinedSecureTextField(state = field, label = { Text(label) }, enabled = enabled, modifier = Modifier.fillMaxWidth())
    } else {
        OutlinedTextField(
            state = field,
            label = { Text(label) },
            enabled = enabled,
            lineLimits = TextFieldLineLimits.MultiLine(1, 4),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
