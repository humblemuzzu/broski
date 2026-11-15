import BroskiCore
import SwiftUI

/// Approve and Deny on a row whose pending ask is a tool permission the backend lets one tap
/// answer: by swipe, by long press and as VoiceOver actions. Any other row offers none; its ask is
/// answered in the chat. Only the person's tap sends an answer.
struct InboxRowActions: ViewModifier {
    let row: InboxRow
    let inbox: InboxModel

    private var decisions: [RowAnswer.Decision] {
        [.approve, .deny].filter { row.quickOption($0) != nil }
    }

    private var busy: Bool { inbox.answering.contains(row.key) }

    func body(content: Content) -> some View {
        content
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                ForEach(decisions, id: \.self) { button(for: $0) }
            }
            .contextMenu {
                ForEach(decisions, id: \.self) { button(for: $0) }
            }
            .accessibilityActions {
                ForEach(decisions, id: \.self) { decision in
                    Button(decision.title) { send(decision) }
                }
            }
    }

    @ViewBuilder
    private func button(for decision: RowAnswer.Decision) -> some View {
        switch decision {
        case .approve:
            Button { send(.approve) } label: { Label(decision.title, systemImage: "checkmark") }
                .tint(Palette.done)
                .disabled(busy)
        case .deny:
            Button(role: .destructive) { send(.deny) } label: { Label(decision.title, systemImage: "xmark") }
                .disabled(busy)
        }
    }

    private func send(_ decision: RowAnswer.Decision) {
        Task { await inbox.answer(row, decision) }
    }
}

extension RowAnswer.Decision {
    var title: String {
        switch self {
        case .approve: "Approve"
        case .deny: "Deny"
        }
    }
}

extension View {
    func inboxRowActions(_ row: InboxRow, inbox: InboxModel) -> some View {
        modifier(InboxRowActions(row: row, inbox: inbox))
    }
}
