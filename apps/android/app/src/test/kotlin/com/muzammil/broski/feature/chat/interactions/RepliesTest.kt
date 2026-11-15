package com.muzammil.broski.feature.chat.interactions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.broski_contract.BooleanField
import uniffi.broski_contract.BooleanValue
import uniffi.broski_contract.ChoicesValue
import uniffi.broski_contract.ConditionOperator
import uniffi.broski_contract.ContractOption
import uniffi.broski_contract.FieldCondition
import uniffi.broski_contract.FormFieldSpec
import uniffi.broski_contract.FormReply
import uniffi.broski_contract.FormScalar
import uniffi.broski_contract.FormValue
import uniffi.broski_contract.GrantKind
import uniffi.broski_contract.InteractionReply
import uniffi.broski_contract.MessagePolicy
import uniffi.broski_contract.MultiselectField
import uniffi.broski_contract.PermissionEffect
import uniffi.broski_contract.PermissionGrant
import uniffi.broski_contract.PermissionOption
import uniffi.broski_contract.PermissionScope
import uniffi.broski_contract.PlanDecision
import uniffi.broski_contract.Question
import uniffi.broski_contract.QuestionAnswer
import uniffi.broski_contract.QuestionOption
import uniffi.broski_contract.StringField
import uniffi.broski_contract.TextValue
import uniffi.broski_contract.ToolPermissionReply
import uniffi.broski_contract.ToolPermissionRequest
import uniffi.broski_core.formFieldDefault
import uniffi.broski_core.formFieldShown

/** The reply each kind of card builds from the person's choices. */
class RepliesTest {
    private fun option(id: String, effect: PermissionEffect, scope: PermissionScope = PermissionScope.ONCE, stops: Boolean = false, message: MessagePolicy = MessagePolicy.NONE) =
        PermissionOption(id, id, effect, scope, stops, message, null)

    private val options = listOf(
        option("allow_once", PermissionEffect.ALLOW),
        option("allow_session", PermissionEffect.ALLOW, PermissionScope.SESSION),
        option("deny", PermissionEffect.DENY, message = MessagePolicy.OPTIONAL),
        option("deny_stop", PermissionEffect.DENY, stops = true),
    )
    private val grants = listOf(PermissionGrant("net", GrantKind.NETWORK, null), PermissionGrant("w", GrantKind.WRITE, "/tmp"))
    private val request = ToolPermissionRequest(null, false, null, emptyList(), options, grants, "allow_once", false)

    @Test
    fun thePlainAllowOnceIsPrimaryAndTheDenyThatGoesOnTakesTheWords() {
        assertEquals("allow_once", primaryAllow(options)?.id)
        assertEquals("deny", denyWithWords(options)?.id)
        assertNull(primaryAllow(listOf(option("a", PermissionEffect.ALLOW, message = MessagePolicy.REQUIRED))))
    }

    @Test
    fun aDenyCarriesTheWordsAndNoGrantsAnAllowCarriesTheKeptGrantsAndNoWordsItCannotTake() {
        assertEquals(
            InteractionReply.ToolPermission(ToolPermissionReply("deny", "Use the staging folder", null, emptyList())),
            permissionReply(request, options[2], "  Use the staging folder ", setOf("net")),
        )
        assertEquals(
            InteractionReply.ToolPermission(ToolPermissionReply("allow_once", null, null, listOf("w"))),
            permissionReply(request, options[0], "ignored", setOf("w")),
        )
        assertEquals(
            InteractionReply.ToolPermission(ToolPermissionReply("deny", null, null, emptyList())),
            permissionReply(request, options[2], "   ", emptySet()),
        )
    }

    @Test
    fun anOptionThatRequiresWordsWaitsForThem() {
        val required = option("why", PermissionEffect.DENY, message = MessagePolicy.REQUIRED)
        val asked = request.grants.map { it.id }.toSet()
        assertFalse(canChoose(request, required, " ", asked))
        assertTrue(canChoose(request, required, "because", asked))
    }

    @Test
    fun anAllowThatAskedForGrantsWaitsForOneToBeKeptAndADenyDoesNot() {
        val allow = options[0]
        val deny = options[2]
        assertFalse("nothing kept", canChoose(request, allow, "", emptySet()))
        assertTrue(canChoose(request, allow, "", setOf("net")))
        assertTrue(canChoose(request, deny, "", emptySet()))
        val noGrants = request.copy(grants = emptyList())
        assertTrue("none were asked for", canChoose(noGrants, allow, "", emptySet()))
    }

    private val library = Question("q0", "Library", "Which?", listOf(QuestionOption("date-fns", null, null), QuestionOption("luxon", null, null)), false, true, false, true)
    private val tags = Question("q1", null, "Tags?", listOf(QuestionOption("a", null, null), QuestionOption("b", null, null)), true, false, false, false)

    @Test
    fun questionsAnswerEachAnsweredQuestionWithItsPicksInOptionOrder() {
        val drafts = mapOf("q0" to QuestionDraft(selected = setOf("luxon")), "q1" to QuestionDraft(selected = setOf("b", "a")))
        assertTrue(questionsComplete(listOf(library, tags), drafts))
        assertEquals(
            InteractionReply.Questions(
                uniffi.broski_contract.QuestionsReply(listOf(QuestionAnswer("q0", listOf("luxon"), null), QuestionAnswer("q1", listOf("a", "b"), null))),
            ),
            questionsReply(listOf(library, tags), drafts),
        )
    }

    @Test
    fun aSingleChoiceAnsweredInTheirOwnWordsSendsOnlyTheWordsAndARequiredQuestionMustBeAnswered() {
        assertFalse(questionsComplete(listOf(library, tags), mapOf("q1" to QuestionDraft(selected = setOf("a")))))
        val reply = questionsReply(listOf(library), mapOf("q0" to QuestionDraft(selected = setOf("luxon"), custom = "moment")))
        assertEquals(listOf(QuestionAnswer("q0", emptyList(), "moment")), (reply as InteractionReply.Questions).v1.answers)
    }

    private val email = FormFieldSpec.String(StringField("email", null, null, true, false, emptyList(), null, null, null, null, null, null, emptyList(), false))
    private val notify = FormFieldSpec.Boolean(BooleanField("notify", null, null, false, false, emptyList(), true))
    private val channels = FormFieldSpec.Multiselect(
        MultiselectField(
            "channels", null, null, true, false,
            listOf(FieldCondition("notify", ConditionOperator.EQ, FormScalar.Boolean(BooleanValue(true)))),
            listOf(ContractOption("mail", "Mail", null)), 1, null, false, null,
        ),
    )

    @Test
    fun aFormAnswersTheFieldsShownDefaultsIncludedAndAHiddenConditionDropsAField() {
        val fields = listOf(email, notify, channels)
        val values = fields.mapNotNull { field -> formFieldDefault(field)?.let { field.key to it } }.toMap().toMutableMap()
        assertFalse("email and channels are required", formComplete(fields, values))
        values["email"] = FormValue.Text(TextValue("me@example.com"))
        values["channels"] = FormValue.Choices(ChoicesValue(listOf("mail")))
        assertTrue(formComplete(fields, values))
        assertEquals(setOf("email", "notify", "channels"), ((formReply(fields, values) as InteractionReply.Form).v1 as FormReply).values.keys)

        values["notify"] = FormValue.Boolean(BooleanValue(false))
        assertFalse(formFieldShown(channels, values))
        assertEquals(setOf("email", "notify"), (formReply(fields, values) as InteractionReply.Form).v1.values.keys)
    }

    @Test
    fun aPlanIsApprovedWithItsModeOrRejectedWithWhy() {
        val approve = (planReply(approve = true, feedback = "ignored", modeAfter = "edits") as InteractionReply.PlanApproval).v1
        assertEquals(PlanDecision.APPROVE to "edits", approve.decision to approve.modeAfter)
        assertNull(approve.feedback)
        val reject = (planReply(approve = false, feedback = " Smaller steps ", modeAfter = "edits") as InteractionReply.PlanApproval).v1
        assertEquals(Triple(PlanDecision.REJECT, "Smaller steps", null), Triple(reject.decision, reject.feedback, reject.modeAfter))
    }
}
