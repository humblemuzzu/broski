import BroskiCore
import SwiftUI

/// A row's actions, by swipe, by long press and as VoiceOver actions. Approve and Deny only on a
/// row whose pending ask is a tool permission the backend lets one tap answer; any other ask is
/// answered in the chat, and only the person's tap sends an answer. Then Mark as Read on a Done
/// row and Mark as Unread on an Idle one, Pin and Mute.
struct InboxRowActions: ViewModifier {
    let row: InboxRow
    let inbox: InboxModel
    let preferences: SessionPreferences

    private var decisions: [RowAnswer.Decision] {
        [.approve, .deny].filter { row.quickOption($0) != nil }
    }

    private var busy: Bool { inbox.answering.contains(row.key) }
    private var pinned: Bool { preferences.pinned.contains(row.target) }
    private var muted: Bool { preferences.muted.contains(row.target) }

    func body(content: Content) -> some View {
        content
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                ForEach(decisions, id: \.self) { button(for: $0) }
            }
            .swipeActions(edge: .leading) {
                readButton.tint(.blue)
                pinButton.tint(Palette.caution)
            }
            .contextMenu {
                ForEach(decisions, id: \.self) { button(for: $0) }
                Section {
                    pinButton
                    readButton
                    muteButton
                }
            }
            .accessibilityActions {
                ForEach(decisions, id: \.self) { decision in
                    Button(decision.title) { send(decision) }
                }
                readButton
                pinButton
                muteButton
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

    @ViewBuilder
    private var readButton: some View {
        switch row.state {
        case .done:
            Button("Mark as Read", systemImage: "envelope.open") {
                inbox.markSeen(machineId: row.machineId, session: row.session)
            }
        case .idle:
            Button("Mark as Unread", systemImage: "envelope.badge") {
                inbox.markUnread(machineId: row.machineId, session: row.session)
            }
        case .needsYou, .working:
            EmptyView()
        }
    }

    private var pinButton: some View {
        Button(pinned ? "Unpin" : "Pin", systemImage: pinned ? "pin.slash" : "pin") {
            preferences.setPinned(!pinned, row.target)
        }
    }

    private var muteButton: some View {
        Button(muted ? "Unmute" : "Mute", systemImage: muted ? "bell" : "bell.slash") {
            preferences.setMuted(!muted, row.target)
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
    func inboxRowActions(_ row: InboxRow, inbox: InboxModel, preferences: SessionPreferences) -> some View {
        modifier(InboxRowActions(row: row, inbox: inbox, preferences: preferences))
    }
}
