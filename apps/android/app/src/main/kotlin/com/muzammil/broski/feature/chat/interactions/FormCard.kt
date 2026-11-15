package com.muzammil.broski.feature.chat.interactions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import uniffi.broski_contract.BooleanValue
import uniffi.broski_contract.ChoicesValue
import uniffi.broski_contract.FormFieldSpec
import uniffi.broski_contract.FormRequest
import uniffi.broski_contract.FormValue
import uniffi.broski_contract.Interaction
import uniffi.broski_contract.NumberValue
import uniffi.broski_contract.StringFormat
import uniffi.broski_contract.TextValue

/** A form from its field specs: text with the keyboard its format wants, numbers, switches, choice chips. */
@Composable
fun FormCard(interaction: Interaction, request: FormRequest, context: CardContext) {
    val haptics = LocalHapticFeedback.current
    val values = remember(interaction.id) {
        mutableStateMapOf<String, FormValue>().apply { request.fields.forEach { field -> field.initial()?.let { put(field.key, it) } } }
    }
    Text(listOfNotNull(request.server, interaction.title).joinToString(" · "), style = MaterialTheme.typography.titleMedium)
    interaction.body?.let { Quiet(it) }
    request.fields.filter { it.active(values) }.forEach { field ->
        FieldView(field, values[field.key], context.enabled) { value -> if (value == null) values.remove(field.key) else values[field.key] = value }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Button(
            onClick = {
                haptics.perform(Haptic.Success)
                context.answer(formReply(request.fields, values))
            },
            enabled = context.enabled && formComplete(request.fields, values),
            shapes = ButtonDefaults.shapes(),
        ) { Text(stringResource(R.string.card_submit)) }
        TextButton(onClick = { context.answer(dismissReply()) }, enabled = context.enabled) { Text(stringResource(R.string.card_dismiss)) }
    }
}

@Composable
private fun FieldView(field: FormFieldSpec, value: FormValue?, enabled: Boolean, onChange: (FormValue?) -> Unit) {
    val label = (field.title ?: field.key) + if (field.required) " *" else ""
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        when (field) {
            is FormFieldSpec.Boolean -> Row(verticalAlignment = Alignment.CenterVertically) {
                Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                Switch((value as? FormValue.Boolean)?.v1?.value ?: false, { onChange(FormValue.Boolean(BooleanValue(it))) }, enabled = enabled)
            }
            is FormFieldSpec.Multiselect -> Choices(label, field, value, enabled, onChange)
            is FormFieldSpec.String -> StringFieldView(label, field, (value as? FormValue.Text)?.v1?.value.orEmpty(), enabled) { typed ->
                onChange(typed.takeIf { it.isNotEmpty() }?.let { FormValue.Text(TextValue(it)) })
            }
            is FormFieldSpec.Number, is FormFieldSpec.Integer -> {
                val shown = (value as? FormValue.Number)?.v1?.value?.let { if (field is FormFieldSpec.Integer) it.toLong().toString() else it.toString() }
                val keyboard = if (field is FormFieldSpec.Integer) KeyboardType.Number else KeyboardType.Decimal
                TypedField(label, shown.orEmpty(), keyboard, enabled) { typed -> onChange(typed.toDoubleOrNull()?.let { FormValue.Number(NumberValue(it)) }) }
            }
        }
        field.description?.let { Quiet(it) }
    }
}

/** A string as its spec asks: one of its options, a day from the date picker, or typed with the keyboard its format wants. */
@Composable
private fun StringFieldView(label: String, field: FormFieldSpec.String, value: String, enabled: Boolean, onChange: (String) -> Unit) {
    val spec = field.v1
    when {
        spec.options.isNotEmpty() && !spec.allowCustom -> {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                spec.options.forEach { option ->
                    FilterChip(selected = option.value == value, enabled = enabled, onClick = { onChange(option.value) }, label = { Text(option.label) })
                }
            }
        }
        spec.format == StringFormat.DATE -> DateField(label, value, enabled, onChange)
        else -> TypedField(label, value, spec.format.keyboard, enabled, onChange)
    }
}

private val StringFormat?.keyboard: KeyboardType
    get() = when (this) {
        StringFormat.EMAIL -> KeyboardType.Email
        StringFormat.URI -> KeyboardType.Uri
        StringFormat.DATE, StringFormat.DATE_TIME, null -> KeyboardType.Text
    }

@Composable
private fun TypedField(label: String, initial: String, keyboard: KeyboardType, enabled: Boolean, onChange: (String) -> Unit) {
    val state = rememberTextFieldState(initial)
    LaunchedEffect(state) { snapshotFlow { state.text.toString() }.collect(onChange) }
    OutlinedTextField(
        state = state,
        label = { Text(label) },
        enabled = enabled,
        lineLimits = TextFieldLineLimits.SingleLine,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun Choices(label: String, field: FormFieldSpec.Multiselect, value: FormValue?, enabled: Boolean, onChange: (FormValue?) -> Unit) {
    val chosen = (value as? FormValue.Choices)?.v1?.values.orEmpty()
    Text(label, style = MaterialTheme.typography.bodyLarge)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        field.v1.options.forEach { option ->
            val on = option.value in chosen
            FilterChip(
                selected = on,
                enabled = enabled,
                onClick = { onChange(FormValue.Choices(ChoicesValue(if (on) chosen - option.value else chosen + option.value))) },
                label = { Text(option.label) },
            )
        }
    }
}
