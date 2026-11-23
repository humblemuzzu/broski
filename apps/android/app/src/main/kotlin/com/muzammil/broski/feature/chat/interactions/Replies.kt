package com.muzammil.broski.feature.chat.interactions

import uniffi.broski_contract.CancelReply
import uniffi.broski_contract.ChoiceReply
import uniffi.broski_contract.ConfirmReply
import uniffi.broski_contract.FormFieldSpec
import uniffi.broski_contract.FormReply
import uniffi.broski_contract.FormValue
import uniffi.broski_contract.InteractionReply
import uniffi.broski_contract.MessagePolicy
import uniffi.broski_contract.PermissionEffect
import uniffi.broski_contract.PermissionOption
import uniffi.broski_contract.PermissionScope
import uniffi.broski_contract.PlanApprovalReply
import uniffi.broski_contract.PlanDecision
import uniffi.broski_contract.Question
import uniffi.broski_contract.QuestionAnswer
import uniffi.broski_contract.QuestionsReply
import uniffi.broski_contract.TextReply
import uniffi.broski_contract.ToolPermissionReply
import uniffi.broski_contract.ToolPermissionRequest
import uniffi.broski_core.formFieldShown

/*
 * The replies the person's taps make, one builder per kind. Each sends only what the person chose:
 * the bridge checks every answer (`answerProblem`), so nothing here validates beyond what the card
 * needs to know whether its button can be pressed.
 */

/** The plain allow-once: the one filled button of a permission card, when the backend offers it. */
fun primaryAllow(options: List<PermissionOption>): PermissionOption? = options.firstOrNull {
    it.effect == PermissionEffect.ALLOW && it.scope == PermissionScope.ONCE && it.message != MessagePolicy.REQUIRED
}

/** The deny that goes on with the person's words ("Tell Pi what to do instead"), when one takes words. */
fun denyWithWords(options: List<PermissionOption>): PermissionOption? = options.firstOrNull {
    it.effect == PermissionEffect.DENY && !it.stopsRun && it.message != MessagePolicy.NONE
}

/** The Deny beside Allow: the deny that lets the run go on, else the first deny. */
fun plainDeny(options: List<PermissionOption>): PermissionOption? =
    options.firstOrNull { it.effect == PermissionEffect.DENY && !it.stopsRun } ?: options.firstOrNull { it.effect == PermissionEffect.DENY }

/** The denies kept in the card's menu: every one but the Deny beside Allow (Deny and Stop). */
fun menuDenies(options: List<PermissionOption>): List<PermissionOption> {
    val plain = plainDeny(options)
    return options.filter { it.effect == PermissionEffect.DENY && it != plain }
}

/** Whether [option] can go now: the words it requires are typed, and an allow keeps a grant when grants were asked for. */
fun canChoose(request: ToolPermissionRequest, option: PermissionOption, message: String, grants: Set<String>): Boolean =
    (option.message != MessagePolicy.REQUIRED || message.isNotBlank()) &&
        !(option.effect == PermissionEffect.ALLOW && request.grants.isNotEmpty() && grants.isEmpty())

/**
 * [option], with [message] when the option takes words, and on an allow the [grants] the person
 * kept of those the request asked for; a deny grants nothing.
 */
fun permissionReply(request: ToolPermissionRequest, option: PermissionOption, message: String, grants: Set<String>): InteractionReply =
    InteractionReply.ToolPermission(
        ToolPermissionReply(
            optionId = option.id,
            message = message.trim().takeIf { it.isNotEmpty() && option.message != MessagePolicy.NONE },
            editedInput = null,
            grantIds = if (option.effect == PermissionEffect.ALLOW) request.grants.map { it.id }.filter { it in grants } else emptyList(),
        ),
    )

/** What the person picked and typed for one question. */
data class QuestionDraft(val selected: Set<String> = emptySet(), val custom: String = "") {
    val answered: Boolean get() = selected.isNotEmpty() || custom.isNotBlank()
}

fun questionsComplete(questions: List<Question>, drafts: Map<String, QuestionDraft>): Boolean =
    questions.all { !it.required || drafts[it.id]?.answered == true }

/**
 * An answer per question the person answered, its picks in the options' order. A single-choice
 * question answers either a pick or the person's own words, never both.
 */
fun questionsReply(questions: List<Question>, drafts: Map<String, QuestionDraft>): InteractionReply =
    InteractionReply.Questions(
        QuestionsReply(
            questions.mapNotNull { question ->
                val draft = drafts[question.id]?.takeIf { it.answered } ?: return@mapNotNull null
                val custom = draft.custom.trim().takeIf { it.isNotEmpty() && question.allowCustom }
                val picked = question.options.map { it.label }.filter { it in draft.selected }
                val selected = if (!question.multiSelect && custom != null) emptyList() else picked
                QuestionAnswer(question.id, selected, custom)
            },
        ),
    )

/** The values of the fields shown, and of those the person left at their defaults. */
fun formReply(fields: List<FormFieldSpec>, values: Map<String, FormValue>): InteractionReply =
    InteractionReply.Form(FormReply(fields.filter { formFieldShown(it, values) }.mapNotNull { field -> values[field.key]?.let { field.key to it } }.toMap()))

fun formComplete(fields: List<FormFieldSpec>, values: Map<String, FormValue>): Boolean =
    fields.filter { formFieldShown(it, values) && it.required }.all { field ->
        when (val value = values[field.key]) {
            null -> false
            is FormValue.Text -> value.v1.value.isNotBlank()
            is FormValue.Choices -> value.v1.values.isNotEmpty()
            else -> true
        }
    }

fun planReply(approve: Boolean, feedback: String, modeAfter: String?): InteractionReply = InteractionReply.PlanApproval(
    if (approve) {
        PlanApprovalReply(PlanDecision.APPROVE, plan = null, feedback = null, modeAfter = modeAfter)
    } else {
        PlanApprovalReply(PlanDecision.REJECT, plan = null, feedback = feedback.trim().takeIf { it.isNotEmpty() }, modeAfter = null)
    },
)

fun choiceReply(value: String): InteractionReply = InteractionReply.Choice(ChoiceReply(value))

fun confirmReply(confirmed: Boolean): InteractionReply = InteractionReply.Confirm(ConfirmReply(confirmed))

fun textReply(text: String): InteractionReply = InteractionReply.Text(TextReply(text))

/** The person put the ask away without answering; the run goes on without it. */
fun dismissReply(): InteractionReply = InteractionReply.Cancel(CancelReply(stopRun = false, message = null))
