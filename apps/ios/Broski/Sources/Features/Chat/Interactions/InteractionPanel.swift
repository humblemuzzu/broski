import BroskiCore
import SwiftUI

/// The first pending ask, pinned above the composer and never in the scroll: a card the person can
/// fold into a pill to read the transcript first. It stays until the bridge withdraws the ask; while
/// an answer is on its way its buttons wait, and an answer that lost the race says so.
struct InteractionPanel: View {
    let chat: ChatModel
    let interaction: Interaction
    let agent: String
    @State private var collapsed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var isSending: Bool { chat.answering.contains(interaction.id) }
    private var waiting: Int { chat.interactions.count - 1 }

    var body: some View {
        Group {
            if collapsed {
                pill
            } else {
                card
            }
        }
        .animation(reduceMotion ? .easeOut(duration: 0.14) : .easeOut(duration: 0.22), value: collapsed)
    }

    private var pill: some View {
        Button { collapsed = false } label: {
            HStack(spacing: Spacing.s) {
                Circle().fill(Palette.needsYou).frame(width: 8, height: 8)
                Text(interaction.request.pillWords).font(.subheadline.weight(.semibold))
                Spacer(minLength: 0)
                Image(systemName: "chevron.up").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, Spacing.l)
            .padding(.vertical, Spacing.m)
            .background(.regularMaterial, in: .capsule)
            .overlay { Capsule().strokeBorder(.separator, lineWidth: 0.5) }
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Shows the question")
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            header
            ScrollView {
                kind.frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(maxHeight: 320)
            .fixedSize(horizontal: false, vertical: true)
            if let problem = chat.answerProblems[interaction.id] {
                Label(problem.message, systemImage: problem.isStale ? "checkmark.circle" : "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(problem.isStale ? .secondary : Palette.failed)
            }
        }
        .padding(Spacing.l)
        .background(.regularMaterial, in: .rect(cornerRadius: Radius.card, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(.separator, lineWidth: 0.5) }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
            Text(interaction.request.label)
                .font(.caption2.weight(.bold))
                .tracking(1.1)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if waiting > 0 {
                Text("· \(waiting) more").font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            if chat.canAnswer && !isPermission {
                Menu {
                    Button("Dismiss") { answer(.cancel(CancelReply(stopRun: false, message: nil))) }
                    Button("Dismiss and Stop", role: .destructive) { answer(.cancel(CancelReply(stopRun: true, message: nil))) }
                } label: {
                    Image(systemName: "ellipsis").frame(width: 28, height: 28).contentShape(.rect)
                }
                .foregroundStyle(.secondary)
                .accessibilityLabel("More")
            }
            Button { collapsed = true } label: {
                Image(systemName: "chevron.down").font(.footnote.weight(.semibold)).frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .accessibilityLabel("Hide for now")
        }
    }

    private var isPermission: Bool {
        if case .toolPermission = interaction.request { true } else { false }
    }

    @ViewBuilder
    private var kind: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            if !isPermission {
                Text(interaction.title).font(.headline)
                if let body = interaction.body { FormattedMessage(text: body, role: .quiet) }
            }
            if chat.canAnswer {
                answers
            } else {
                Text("Answer this where the session runs, on your Mac.").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var answers: some View {
        switch interaction.request {
        case .toolPermission(let request):
            PermissionCard(interaction: interaction, request: request, agent: agent, isSending: isSending, send: answer)
        case .questions(let request):
            QuestionsCard(request: request, isSending: isSending, send: answer)
        case .form(let request):
            FormCard(request: request, isSending: isSending, send: answer)
        case .planApproval(let request):
            PlanCard(request: request, isSending: isSending, send: answer)
        case .choice, .confirm, .text:
            DialogCard(request: interaction.request, isSending: isSending, send: answer)
        }
    }

    private func answer(_ reply: InteractionReply) {
        Task { await chat.answer(interaction, reply) }
    }
}

extension InteractionRequest {
    /// The card's micro-label.
    var label: String {
        switch self {
        case .toolPermission: "APPROVAL NEEDED"
        case .planApproval: "PLAN TO APPROVE"
        default: "NEEDS YOUR ANSWER"
        }
    }

    /// What the folded card says.
    var pillWords: String {
        switch self {
        case .toolPermission: "Needs your approval"
        case .questions(let request) where request.questions.count > 1:
            "Needs your answer · \(request.questions.count) questions"
        case .planApproval: "Needs your approval · plan"
        default: "Needs your answer"
        }
    }
}
