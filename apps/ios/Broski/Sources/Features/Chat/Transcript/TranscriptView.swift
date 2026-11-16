import BroskiCore
import SwiftUI

/// The transcript, full bleed under the header and the composer: finished runs, then the live run,
/// then the status lane. It follows its end by anchoring growth to the bottom while following and to
/// the top while the person reads above (never a scroll per update); a short conversation sits at
/// the bottom; older pages load before the top comes into view and keep the reader's place.
struct TranscriptView: View {
    let chat: ChatModel
    let dimmed: Bool
    /// What the link is doing while it cannot reach the Mac, which is why the conversation is late.
    let connection: String?
    let dismissKeyboard: () -> Void
    @Binding var position: ScrollPosition
    @State private var personScrolling = false
    @State private var olderAnchor: String?
    @State private var screensFromTop = CGFloat.infinity

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                OlderPages(chat: chat)
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
            chat.updateFollow { $0.scrolled(distanceFromEnd: distance, byPerson: personScrolling) }
        }
        .onScrollGeometryChange(for: CGFloat.self, of: Self.visibleHeight) { _, _ in
            // The end row, not `scrollTo(edge: .bottom)`: that one resets the horizontal offset to 0, and the
            // whole transcript lands the width of its side margin to the left.
            if chat.follow.isFollowing { position.scrollTo(id: Self.endId, anchor: .bottom) }
        }
        .onScrollGeometryChange(for: CGFloat.self, of: Self.screensFromTop) { _, screens in
            screensFromTop = screens
            prefetchOlder()
        }
        .onChange(of: chat.history.olderCursor) { prefetchOlder() }
        .onChange(of: chat.isRevealed) { prefetchOlder() }
        .onChange(of: chat.historyRows.first?.id) {
            guard let olderAnchor else { return }
            self.olderAnchor = nil
            position.scrollTo(id: olderAnchor, anchor: .top)
        }
        .simultaneousGesture(TapGesture().onEnded(dismissKeyboard))
        .opacity(chat.isRevealed ? (dimmed ? 0.5 : 1) : 0)
        .animation(.easeOut(duration: 0.2), value: chat.isRevealed)
        .overlay {
            if chat.isRevealed, !chat.history.isLoaded, chat.historyProblem == nil {
                LoadingConversation(connection: connection)
            }
        }
    }

    static let endId = "transcript-end"

    /// Older pages load while the top is still this many screens away, so a drag at the top of a chat
    /// opened with the zoom transition (which dismisses it) never meets a page still on its way.
    private static let prefetchScreens: CGFloat = 2

    private func prefetchOlder() {
        guard chat.isRevealed, chat.history.hasOlder, chat.historyProblem == nil, screensFromTop < Self.prefetchScreens else { return }
        olderAnchor = chat.historyRows.first?.id
        Task { await chat.loadOlder() }
    }

    /// How far the visible top is below the content's top, in screens.
    nonisolated static func screensFromTop(_ geometry: ScrollGeometry) -> CGFloat {
        (geometry.contentOffset.y + geometry.contentInsets.top) / max(geometry.containerSize.height, 1)
    }

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

/// What a chat shows while its newest page is still on its way: a slow link must not read as an
/// empty conversation.
private struct LoadingConversation: View {
    let connection: String?

    var body: some View {
        VStack(spacing: Spacing.s) {
            ProgressView()
            Text(connection ?? "Loading the conversation").font(.footnote).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .contentTransition(.opacity)
        }
        .padding(.horizontal, Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .allowsHitTesting(false)
        .transition(.opacity)
    }
}

/// The top of what is loaded: a spinner while older pages load (they load well before the top is in
/// view, so it is feedback only), or what stopped them.
private struct OlderPages: View {
    let chat: ChatModel

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
        }
    }
}
