import BroskiCore
import SwiftUI

/// The transcript, full bleed under the header and the composer: finished runs, then the live run,
/// then the status lane. It follows its end by anchoring growth to the bottom while following and to
/// the top while the person reads above (never a scroll per update); a short conversation sits at
/// the bottom; older pages load as the top comes into view and keep the reader's place.
struct TranscriptView: View {
    let chat: ChatModel
    let dimmed: Bool
    let dismissKeyboard: () -> Void
    @Binding var position: ScrollPosition
    @State private var personScrolling = false
    @State private var olderAnchor: String?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                OlderPages(chat: chat) { olderAnchor = chat.historyRows.first?.id }
                ForEach(chat.historyRows) { row in
                    ChatRowView(row: row, isFresh: false).equatable()
                }
                ForEach(chat.liveRows) { row in
                    ChatRowView(row: row, isFresh: chat.isFresh(row)).equatable()
                }
                StatusLaneView(status: LaneStatus(chat.snapshot))
                    .padding(.top, Spacing.s)
                    .id(TranscriptView.endId)
            }
            .scrollTargetLayout()
        }
        .contentMargins(.horizontal, Spacing.l + Spacing.xs, for: .scrollContent)
        .contentMargins(.vertical, Spacing.m, for: .scrollContent)
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .defaultScrollAnchor(.bottom, for: .alignment)
        .defaultScrollAnchor(chat.follow.isFollowing ? .bottom : .top, for: .sizeChanges)
        .scrollEdgeEffectStyle(.soft, for: .top)
        .scrollDismissesKeyboard(.interactively)
        .onScrollPhaseChange { _, phase in
            personScrolling = phase == .tracking || phase == .interacting || phase == .decelerating
        }
        .onScrollGeometryChange(for: CGFloat.self, of: Self.distanceFromEnd) { _, distance in
            chat.follow.scrolled(distanceFromEnd: distance, byPerson: personScrolling)
        }
        .onScrollGeometryChange(for: CGFloat.self, of: Self.visibleHeight) { _, _ in
            if chat.follow.isFollowing { position.scrollTo(edge: .bottom) }
        }
        .onChange(of: chat.historyRows.first?.id) {
            guard let olderAnchor else { return }
            self.olderAnchor = nil
            position.scrollTo(id: olderAnchor, anchor: .top)
        }
        .simultaneousGesture(TapGesture().onEnded(dismissKeyboard))
        .opacity(chat.isRevealed ? (dimmed ? 0.5 : 1) : 0)
        .animation(.easeOut(duration: 0.2), value: chat.isRevealed)
    }

    static let endId = "transcript-end"

    /// The height content shows in, which the keyboard and the composer's growth change: the
    /// anchor keeps the end in place as content grows, and this keeps it as the window shrinks.
    nonisolated static func visibleHeight(_ geometry: ScrollGeometry) -> CGFloat {
        geometry.containerSize.height - geometry.contentInsets.top - geometry.contentInsets.bottom
    }

    /// How far the visible end is above the content's end, insets included.
    nonisolated static func distanceFromEnd(_ geometry: ScrollGeometry) -> CGFloat {
        let maxOffset = geometry.contentSize.height + geometry.contentInsets.bottom - geometry.containerSize.height
        return max(0, maxOffset - geometry.contentOffset.y)
    }
}

/// The top of what is loaded: older pages load as it comes into view, or what stopped them says so.
private struct OlderPages: View {
    let chat: ChatModel
    let willLoad: () -> Void

    var body: some View {
        if let problem = chat.historyProblem {
            Banner(style: .warning, message: "Couldn't read this conversation's history. \(problem.message)") {
                Button("Try Again") { Task { await chat.loadNewest() } }
            }
            .padding(.bottom, Spacing.l)
        } else if chat.history.hasOlder {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.l)
                // Keyed by the cursor too: a row still on screen when a page lands (or that came back
                // while a page was out) loads the next one.
                .task(id: chat.isRevealed ? chat.history.olderCursor : nil) {
                    guard chat.isRevealed else { return }
                    willLoad()
                    await chat.loadOlder()
                }
        }
    }
}
