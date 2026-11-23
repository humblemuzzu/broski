import BroskiCore
import SwiftUI
import UIKit

/// The first pending ask, in place of the composer and never in the scroll, until the bridge
/// withdraws it: what the agent wants as its title, the ask scrolling under it, and the answers
/// pinned at the bottom where the thumb is. Folding it gives the composer back under a pill; while
/// an answer is on its way its buttons wait, and an answer that lost the race says so.
struct InteractionPanel: View {
    let chat: ChatModel
    let interaction: Interaction
    let agent: String
    let fold: () -> Void
    @State private var keyboardUp = false
    @State private var allowed = 0
    @State private var refused = 0

    private var isSending: Bool { chat.answering.contains(interaction.id) }
    private var waiting: Int { chat.interactions.count - 1 }
    private var isPermission: Bool {
        if case .toolPermission = interaction.request { true } else { false }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            header
            if chat.canAnswer {
                answers
                    .environment(\.askContentCap, keyboardUp ? 150 : 320)
                    .environment(\.askIntro, isPermission ? nil : interaction.body.map(agentLine))
            } else {
                Text("Answer this where the session runs, on your Mac.").font(.footnote).foregroundStyle(.secondary)
            }
            if let problem = chat.answerProblems[interaction.id] {
                Label(problem.message, systemImage: problem.isStale ? "checkmark.circle" : "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(problem.isStale ? .secondary : Palette.failed)
            }
        }
        .padding(Spacing.l)
        .background(.regularMaterial, in: .rect(cornerRadius: Radius.sheetCard, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.sheetCard, style: .continuous).strokeBorder(.separator.opacity(0.6), lineWidth: 0.5)
        }
        .haptic(.confirmed, trigger: allowed)
        .haptic(.destructive, trigger: refused)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardUp = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardUp = false }
        .animation(.spring(duration: 0.3, bounce: 0.1), value: keyboardUp)
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: Spacing.s) {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(title)
                    .font(.headline)
                    .lineLimit(2)
                    .accessibilityAddTraits(.isHeader)
                Text(waiting > 0 ? "\(interaction.request.kindWords) · \(waiting) more waiting" : interaction.request.kindWords)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
            .onTapGesture { dismissKeyboard() }
            if chat.canAnswer && !menuItems.isEmpty { menu }
            HeaderButton(symbol: "chevron.down", label: "Hide for now", action: fold)
        }
    }

    private var title: String {
        if case .toolPermission(let request) = interaction.request {
            return switch request.previews.first {
            case .command: "\(agent) wants to run"
            case .fileChanges: "\(agent) wants to change files"
            case .network(let host): "\(agent) wants to reach \(host.host)"
            case .paths: "\(agent) wants to use these paths"
            case nil: agentLine(interaction.title)
            }
        }
        return agentLine(interaction.title)
    }

    private var menuItems: [(label: String, reply: InteractionReply)] {
        if case .toolPermission(let request) = interaction.request {
            let answer = PermissionAnswer(request: request)
            return answer.menuDenies.map { (agentLine($0.label), answer.reply($0, message: "", grants: [])) }
        }
        return [
            ("Dismiss", .cancel(CancelReply(stopRun: false, message: nil))),
            ("Dismiss and Stop", .cancel(CancelReply(stopRun: true, message: nil))),
        ]
    }

    private var menu: some View {
        Menu {
            ForEach(menuItems.indices, id: \.self) { index in
                let item = menuItems[index]
                Button(item.label, role: index == menuItems.count - 1 ? .destructive : nil) { answer(item.reply) }
            }
        } label: {
            HeaderButtonLabel(symbol: "ellipsis")
        }
        .disabled(isSending)
        .accessibilityLabel("More")
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
        dismissKeyboard()
        if refuses(reply) { refused += 1 } else { allowed += 1 }
        Task { await chat.answer(interaction, reply) }
    }

    private func refuses(_ reply: InteractionReply) -> Bool {
        if case .toolPermission(let chosen) = reply, case .toolPermission(let request) = interaction.request {
            return request.options.first { $0.id == chosen.optionId }?.effect == .deny
        }
        return reply.refuses
    }

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

/// A round 32 pt control in the card's top corner: fold it away, or its menu.
private struct HeaderButton: View {
    let symbol: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) { HeaderButtonLabel(symbol: symbol) }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
    }
}

private struct HeaderButtonLabel: View {
    let symbol: String

    var body: some View {
        Image(systemName: symbol)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.secondary)
            .frame(width: 32, height: 32)
            .background(Color(uiColor: .tertiarySystemFill), in: .circle)
            .frame(width: 44, height: 44)
            .contentShape(.rect)
    }
}

/// The ask folded away: a pill over the composer that brings it back.
struct AskPill: View {
    let interaction: Interaction
    let waiting: Int
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: Spacing.s) {
                Circle().fill(Palette.needsYou).frame(width: 8, height: 8)
                Text(waiting > 0 ? "\(interaction.request.pillWords) · \(waiting) more" : interaction.request.pillWords)
                    .font(.subheadline.weight(.semibold))
                Spacer(minLength: 0)
                Image(systemName: "chevron.up").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, Spacing.l)
            .padding(.vertical, Spacing.m)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .capsule)
        .accessibilityHint("Shows the question")
    }
}

extension InteractionRequest {
    /// The quiet line under the card's title.
    var kindWords: String {
        switch self {
        case .toolPermission: "Needs your approval"
        case .planApproval: "Plan to approve"
        case .questions(let request) where request.questions.count > 1: "\(request.questions.count) questions"
        default: "Needs your answer"
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

extension InteractionReply {
    /// Whether this answer says no (a deny, a rejected plan, a dismissal), for its haptic.
    var refuses: Bool {
        switch self {
        case .cancel: true
        case .planApproval(let reply): reply.decision == .reject
        case .confirm(let reply): !reply.confirmed
        default: false
        }
    }
}
