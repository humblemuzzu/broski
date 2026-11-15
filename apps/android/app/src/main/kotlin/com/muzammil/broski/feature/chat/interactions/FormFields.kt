package com.muzammil.broski.feature.chat.interactions

import uniffi.broski_contract.BooleanValue
import uniffi.broski_contract.ChoicesValue
import uniffi.broski_contract.ConditionOperator
import uniffi.broski_contract.FieldCondition
import uniffi.broski_contract.FormFieldSpec
import uniffi.broski_contract.FormScalar
import uniffi.broski_contract.FormValue
import uniffi.broski_contract.NumberValue
import uniffi.broski_contract.TextValue

val FormFieldSpec.key: String
    get() = when (this) {
        is FormFieldSpec.String -> v1.key
        is FormFieldSpec.Number -> v1.key
        is FormFieldSpec.Integer -> v1.key
        is FormFieldSpec.Boolean -> v1.key
        is FormFieldSpec.Multiselect -> v1.key
    }

val FormFieldSpec.title: String?
    get() = when (this) {
        is FormFieldSpec.String -> v1.title
        is FormFieldSpec.Number -> v1.title
        is FormFieldSpec.Integer -> v1.title
        is FormFieldSpec.Boolean -> v1.title
        is FormFieldSpec.Multiselect -> v1.title
    }

val FormFieldSpec.description: String?
    get() = when (this) {
        is FormFieldSpec.String -> v1.description
        is FormFieldSpec.Number -> v1.description
        is FormFieldSpec.Integer -> v1.description
        is FormFieldSpec.Boolean -> v1.description
        is FormFieldSpec.Multiselect -> v1.description
    }

val FormFieldSpec.required: Boolean
    get() = when (this) {
        is FormFieldSpec.String -> v1.required
        is FormFieldSpec.Number -> v1.required
        is FormFieldSpec.Integer -> v1.required
        is FormFieldSpec.Boolean -> v1.required
        is FormFieldSpec.Multiselect -> v1.required
    }

private val FormFieldSpec.hidden: Boolean
    get() = when (this) {
        is FormFieldSpec.String -> v1.hidden
        is FormFieldSpec.Number -> v1.hidden
        is FormFieldSpec.Integer -> v1.hidden
        is FormFieldSpec.Boolean -> v1.hidden
        is FormFieldSpec.Multiselect -> v1.hidden
    }

private val FormFieldSpec.conditions: List<FieldCondition>
    get() = when (this) {
        is FormFieldSpec.String -> v1.`when`
        is FormFieldSpec.Number -> v1.`when`
        is FormFieldSpec.Integer -> v1.`when`
        is FormFieldSpec.Boolean -> v1.`when`
        is FormFieldSpec.Multiselect -> v1.`when`
    }

/** The value a field starts with: its default, so an untouched field answers what the backend would assume. */
fun FormFieldSpec.initial(): FormValue? = when (this) {
    is FormFieldSpec.String -> v1.defaultValue?.let { FormValue.Text(TextValue(it)) }
    is FormFieldSpec.Number -> v1.defaultValue?.let { FormValue.Number(NumberValue(it)) }
    is FormFieldSpec.Integer -> v1.defaultValue?.let { FormValue.Number(NumberValue(it.toDouble())) }
    is FormFieldSpec.Boolean -> v1.defaultValue?.let { FormValue.Boolean(BooleanValue(it)) }
    is FormFieldSpec.Multiselect -> v1.defaultValue?.let { FormValue.Choices(ChoicesValue(it)) }
}

/**
 * Whether a field is shown and answered, by the contract's rule (`fieldIsActive`): it is not hidden
 * and every condition holds; `eq` against a multiselect means "includes", and a condition on an
 * unanswered field holds for neither operator.
 */
fun FormFieldSpec.active(values: Map<String, FormValue>): Boolean =
    !hidden && conditions.all { condition -> holds(condition, values[condition.key]) }

private fun holds(condition: FieldCondition, answer: FormValue?): Boolean {
    answer ?: return false
    val equal = when (answer) {
        is FormValue.Choices -> (condition.value as? FormScalar.Text)?.v1?.value in answer.v1.values
        is FormValue.Text -> (condition.value as? FormScalar.Text)?.v1?.value == answer.v1.value
        is FormValue.Number -> (condition.value as? FormScalar.Number)?.v1?.value == answer.v1.value
        is FormValue.Boolean -> (condition.value as? FormScalar.Boolean)?.v1?.value == answer.v1.value
    }
    return if (condition.op == ConditionOperator.EQ) equal else !equal
}
