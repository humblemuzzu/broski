import BroskiCore
import SwiftUI
import ThinkingOrbsKit

struct TranscriptView: View {
    let chat: ChatModel
    let connection: String?
    let dismissKeyboard: () -> Void
    @State private var safeFrame = CGRect.zero
    @State private var fullFrame = CGRect.zero
    @State private var jumps = 0
    @Environment(AppModel.self) private var app
    @Environment(Disclosure.self) private var disclosure
    @Environment(\.openRoute) private var openRoute
    @Environment(\.formatContext) private var formatContext
    @Environment(\.chatMachineId) private var machineId
    @Environment(\.chatImages) private var images
    @Environment(\.modelNames) private var modelNames
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.reading) private var reading

    var body: some View {
        Color.clear
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { safeFrame = $0 }
            .overlay {
                let built = entries
                TranscriptList(
                    entries: built.items, historyRange: built.historyRange, historyRevision: chat.historyRevision,
                    freshIDs: chat.freshRowIDs, insets: insets, following: chat.follow.isFollowing,
                    jumpRequest: chat.jumpRequest, cellContext: cellContext, callbacks: callbacks
                )
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { fullFrame = $0 }
                .ignoresSafeArea()
                .background(Palette.canvas(for: reading.darkCanvas).ignoresSafeArea())
                .opacity(chat.isRevealed ? 1 : 0)
                .animation(.easeOut(duration: 0.2), value: chat.isRevealed)
            }
            .overlay(alignment: .bottom) {
                if chat.isRevealed && !chat.follow.isFollowing {
                    JumpToLatest(unseen: chat.follow.unseen) {
                        jumps += 1
                        chat.requestJump()
                    }
                    .padding(.bottom, Spacing.s)
                }
            }
            .animation(reduceMotion ? .easeOut(duration: 0.14) : .spring(duration: 0.28, bounce: 0.12), value: chat.follow.isFollowing)
            .haptic(.snappedToLatest, trigger: jumps)
            .overlay {
                if chat.isRevealed, !chat.history.isLoaded, chat.historyProblem == nil {
                    LoadingConversation(connection: connection)
                }
            }
    }

    static let sideMargin: CGFloat = Spacing.l

    private var insets: EdgeInsets {
        guard fullFrame.height > 0, safeFrame.height > 0 else { return EdgeInsets() }
        return EdgeInsets(
            top: max(0, safeFrame.minY - fullFrame.minY), leading: 0,
            bottom: max(0, fullFrame.maxY - safeFrame.maxY), trailing: 0)
    }

    private var entries: (items: [(id: String, entry: TranscriptEntry)], historyRange: Range<Int>) {
        var items: [(id: String, entry: TranscriptEntry)] = []
        items.reserveCapacity(chat.historyRows.count + chat.liveRows.count + 2)
        if chat.history.hasOlder || chat.historyProblem != nil {
            items.append((TranscriptEntry.olderID, .older(problem: chat.historyProblem?.message)))
        }
        let historyStart = items.count
        for row in chat.historyRows {
            items.append((row.id, .row(row)))
        }
        let historyEnd = items.count
        for row in chat.liveRows {
            items.append((row.id, .row(row)))
        }
        items.append((TranscriptEntry.laneID, .lane(LaneStatus(chat.snapshot), startedAt: chat.snapshot.run?.startedAt)))
        return (items, historyStart..<historyEnd)
    }

    private var cellContext: TranscriptCellContext {
        TranscriptCellContext(
            app: app, disclosure: disclosure, images: images, formatContext: formatContext, machineId: machineId,
            openRoute: openRoute,
            answerSource: AnswerSource { [chat] rowId in Self.answer(containing: rowId, in: chat) },
            modelNames: modelNames, retryHistory: chat.retryHistory)
    }

    private var callbacks: TranscriptController.Callbacks {
        TranscriptController.Callbacks(
            updateFollow: { [chat] change in
                chat.updateFollow(change)
                return chat.follow
            },
            nearTop: chat.loadOlderIfNeeded,
            dismissKeyboard: dismissKeyboard)
    }

    static func answer(containing rowId: String, in chat: ChatModel) -> String? {
        let rows = chat.historyRows + chat.liveRows
        guard let start = rows.firstIndex(where: { $0.id == rowId }) else { return nil }
        for row in rows[start...] {
            if case .answerEnd(let end) = row.content { return end.text }
            if case .user = row.content { return nil }
        }
        return nil
    }
}

private struct TranscriptList: UIViewControllerRepresentable {
    let entries: [(id: String, entry: TranscriptEntry)]
    let historyRange: Range<Int>
    let historyRevision: Int
    let freshIDs: Set<String>
    let insets: EdgeInsets
    let following: Bool
    let jumpRequest: TranscriptJump?
    let cellContext: TranscriptCellContext
    let callbacks: TranscriptController.Callbacks

    func makeUIViewController(context: Context) -> TranscriptController {
        TranscriptController()
    }

    func updateUIViewController(_ controller: TranscriptController, context: Context) {
        controller.loadViewIfNeeded()
        controller.callbacks = callbacks
        controller.context = cellContext
        controller.show(entries, freshIDs: freshIDs, historyRange: historyRange, historyRevision: historyRevision)
        controller.setBarInsets(insets)
        controller.setFollowing(following)
        controller.jump(jumpRequest)
    }
}

private struct JumpToLatest: View {
    let unseen: Int
    let jump: () -> Void

    var body: some View {
        Button(action: jump) {
            HStack(spacing: Spacing.xs) {
                if unseen > 0 {
                    Text("^[\(unseen) new message](inflect: true)").font(.subheadline.weight(.medium))
                }
                Image(systemName: "arrow.down").font(.body.weight(.semibold))
            }
            .padding(.horizontal, unseen > 0 ? Spacing.m : 0)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .capsule)
        .accessibilityLabel(unseen > 0 ? "Jump to latest, \(unseen) new" : "Jump to latest")
        .transition(.scale(scale: 0.6).combined(with: .opacity))
    }
}

private struct LoadingConversation: View {
    let connection: String?

    var body: some View {
        VStack(spacing: Spacing.s) {
            Orb(.connecting, side: 64)
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
