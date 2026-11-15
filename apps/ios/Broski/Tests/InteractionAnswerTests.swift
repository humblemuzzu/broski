import BroskiCore
import Foundation
import Testing

@testable import Broski

/// The reply each kind of ask sends: exactly what the person chose, shaped as the contract's
/// `answerProblem` accepts it (contract §9).
@Suite
struct InteractionAnswerTests {
    private let options: [PermissionOption] = [
        PermissionOption(id: "allow_once", label: "Allow", effect: .allow, scope: .once, stopsRun: false, message: .none, rule: nil),
        PermissionOption(id: "allow_session", label: "Allow for this session", effect: .allow, scope: .session, stopsRun: false, message: .none, rule: nil),
        PermissionOption(id: "deny", label: "Deny", effect: .deny, scope: .once, stopsRun: false, message: .optional, rule: nil),
        PermissionOption(id: "deny_stop", label: "Deny and stop", effect: .deny, scope: .once, stopsRun: true, message: .none, rule: nil),
    ]

    private func permission(grants: [PermissionGrant] = [], options: [PermissionOption]? = nil) -> PermissionAnswer {
        PermissionAnswer(request: ToolPermissionRequest(
            input: nil, inputEditable: false, reason: nil, previews: [], options: options ?? self.options, grants: grants,
            defaultOptionId: nil, deliberate: false))
    }

    @Test func aPermissionLaysOutTheBackendsOptionsInItsOrder() {
        let answer = permission()
        #expect(answer.primary?.id == "allow_once")
        #expect(answer.otherAllows.map(\.id) == ["allow_session"])
        #expect(answer.denyWithMessage?.id == "deny", "the deny that takes words sits beside the field")
        #expect(answer.otherDenies.map(\.id) == ["deny_stop"])

        let noPlainAllow = permission(options: [options[1], options[3]])
        #expect(noPlainAllow.primary == nil && noPlainAllow.denyWithMessage == nil)
        #expect(noPlainAllow.otherAllows.map(\.id) == ["allow_session"] && noPlainAllow.otherDenies.map(\.id) == ["deny_stop"])
    }

    @Test func denyCarriesWhatToDoInsteadAndAllowCarriesOnlyTheGrantsChosen() {
        let answer = permission()
        #expect(answer.reply(options[2], message: "  Keep the build folder \n", grants: []) == .toolPermission(
            ToolPermissionReply(optionId: "deny", message: "Keep the build folder", editedInput: nil, grantIds: [])))
        #expect(answer.reply(options[2], message: "   ", grants: []) == .toolPermission(
            ToolPermissionReply(optionId: "deny", message: nil, editedInput: nil, grantIds: [])), "no words, no message")
        #expect(answer.reply(options[0], message: "typed but not for this", grants: []) == .toolPermission(
            ToolPermissionReply(optionId: "allow_once", message: nil, editedInput: nil, grantIds: [])),
            "an option that takes no message sends none")

        let grants = [PermissionGrant(id: "g1", kind: .read, target: "/w"), PermissionGrant(id: "g2", kind: .network, target: nil)]
        let granting = permission(grants: grants)
        #expect(!granting.canSend(options[0], message: "", grants: []), "an allow must choose a grant")
        #expect(granting.canSend(options[2], message: "", grants: []))
        #expect(granting.reply(options[0], message: "", grants: ["g2", "g1"]) == .toolPermission(
            ToolPermissionReply(optionId: "allow_once", message: nil, editedInput: nil, grantIds: ["g1", "g2"])))
        #expect(granting.reply(options[2], message: "", grants: ["g1"]) == .toolPermission(
            ToolPermissionReply(optionId: "deny", message: nil, editedInput: nil, grantIds: [])), "a deny grants nothing")

        let required = PermissionOption(id: "why", label: "Deny", effect: .deny, scope: .once, stopsRun: false, message: .required, rule: nil)
        #expect(!permission(options: [required]).canSend(required, message: " ", grants: []))
        #expect(permission(options: [required]).canSend(required, message: "because", grants: []))
    }

    @Test func questionsAnswerEachAnsweredQuestionWithLabelsInOrderAndCustomWords() {
        let library = Question(
            id: "q0", header: "Library", text: "Which library?",
            options: [QuestionOption(label: "date-fns", description: nil, preview: nil), QuestionOption(label: "luxon", description: nil, preview: nil)],
            multiSelect: false, allowCustom: true, secret: false, required: true)
        let extras = Question(
            id: "q1", header: nil, text: "Which extras?",
            options: ["a", "b", "c"].map { QuestionOption(label: $0, description: nil, preview: nil) },
            multiSelect: true, allowCustom: false, secret: false, required: false)
        let request = QuestionsRequest(questions: [library, extras])
        var draft = QuestionsDraft()
        #expect(!draft.isComplete(request), "the required question has no answer")

        draft.toggle("luxon", in: library)
        draft.toggle("date-fns", in: library)
        #expect(draft.isSelected("date-fns", in: library) && !draft.isSelected("luxon", in: library), "one pick replaces another")
        draft.setCustom("dayjs", in: library)
        #expect(!draft.isSelected("date-fns", in: library), "a single answer is an option or words, not both")
        draft.toggle("c", in: extras)
        draft.toggle("a", in: extras)
        #expect(draft.isComplete(request))
        #expect(draft.reply(request) == .questions(QuestionsReply(answers: [
            QuestionAnswer(questionId: "q0", selected: [], custom: "dayjs"),
            QuestionAnswer(questionId: "q1", selected: ["a", "c"], custom: nil),
        ])))

        draft.toggle("a", in: extras)
        draft.toggle("c", in: extras)
        #expect(draft.reply(request) == .questions(QuestionsReply(answers: [QuestionAnswer(questionId: "q0", selected: [], custom: "dayjs")])),
            "an unanswered optional question is left out")
    }

    @Test func aFormSendsItsShownFieldsFromTheirDefaultsAndHidesFieldsWhoseConditionFails() {
        let request = FormRequest(fields: [
            .string(StringField(
                key: "email", title: nil, description: nil, required: true, hidden: false, when: [], format: .email, minLength: nil,
                maxLength: nil, pattern: nil, placeholder: nil, defaultValue: nil, options: [], allowCustom: false)),
            .boolean(BooleanField(key: "notify", title: nil, description: nil, required: false, hidden: false, when: [], defaultValue: true)),
            .multiselect(MultiselectField(
                key: "channels", title: nil, description: nil, required: true, hidden: false,
                when: [FieldCondition(key: "notify", op: .eq, value: .boolean(BooleanValue(value: true)))],
                options: [ContractOption(value: "mail", label: "Mail", description: nil)], minItems: 1, maxItems: nil,
                allowCustom: false, defaultValue: nil)),
            .integer(IntegerField(key: "retries", title: nil, description: nil, required: false, hidden: true, when: [], minimum: 0, maximum: 5, defaultValue: 2)),
        ], server: "deploy")
        var draft = FormDraft(request)
        #expect(draft.shown(request).map(\.key) == ["email", "notify", "channels"], "hidden fields never show")
        #expect(draft.missing(request) == ["email", "channels"])

        draft["notify"] = .boolean(BooleanValue(value: false))
        #expect(draft.shown(request).map(\.key) == ["email", "notify"], "a field shows only while its condition holds")
        draft["email"] = .text(TextValue(value: "me@example.com"))
        draft["channels"] = .choices(ChoicesValue(values: ["mail"]))
        #expect(draft.missing(request).isEmpty)
        #expect(draft.reply(request) == .form(FormReply(values: [
            "email": .text(TextValue(value: "me@example.com")), "notify": .boolean(BooleanValue(value: false)),
        ])), "an answer to a field no longer shown is not sent")
    }

    @Test func aPlanApprovalNamesItsModeOnlyWhenOfferedAndARejectionCarriesTheNote() {
        let offering = PlanApprovalRequest(
            plan: "# Plan", editable: false, path: nil,
            modeOptions: PlanModeOptions(axis: "permissions", options: [ContractOption(value: "edits", label: "Accept edits", description: nil)], defaultValue: nil))
        #expect(PlanAnswer.approve(offering, modeAfter: "edits") == .planApproval(
            PlanApprovalReply(decision: .approve, plan: nil, feedback: nil, modeAfter: "edits")))
        let plain = PlanApprovalRequest(plan: "# Plan", editable: false, path: nil, modeOptions: nil)
        #expect(PlanAnswer.approve(plain, modeAfter: "") == .planApproval(
            PlanApprovalReply(decision: .approve, plan: nil, feedback: nil, modeAfter: nil)))
        #expect(PlanAnswer.reject(feedback: " Smaller steps ") == .planApproval(
            PlanApprovalReply(decision: .reject, plan: nil, feedback: "Smaller steps", modeAfter: nil)))
        #expect(PlanAnswer.reject(feedback: "") == .planApproval(
            PlanApprovalReply(decision: .reject, plan: nil, feedback: nil, modeAfter: nil)))
    }

    @Test func aSingleLineTextAnswerHoldsNoLineBreak() {
        let single = TextRequest(placeholder: nil, initialText: nil, multiline: false)
        #expect(DialogAnswer.text("feature/\nx", for: single) == .text(TextReply(text: "feature/ x")))
        let multi = TextRequest(placeholder: nil, initialText: nil, multiline: true)
        #expect(DialogAnswer.text("a\nb", for: multi) == .text(TextReply(text: "a\nb")))
    }

    @Test func aDenialOrADismissalPlaysTheWarningNotTheSuccess() {
        let ask = Interaction(
            id: "i", runId: "r", createdAt: 0, expiresAt: nil, title: "Run bash?", body: nil, blocksRun: true, origin: nil,
            request: .toolPermission(ToolPermissionRequest(
                input: nil, inputEditable: false, reason: nil, previews: [], options: options, grants: [], defaultOptionId: nil,
                deliberate: false)))
        #expect(ask.isRefusal(permission().reply(options[2], message: "", grants: [])))
        #expect(!ask.isRefusal(permission().reply(options[0], message: "", grants: [])))
        #expect(ask.isRefusal(.cancel(CancelReply(stopRun: false, message: nil))))
        #expect(!ask.isRefusal(.choice(ChoiceReply(value: "retry"))))
    }
}
