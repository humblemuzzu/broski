import BroskiCore
import SwiftUI
import Testing
import UIKit
@testable import Broski

struct TranscriptScrollTests {
    @Test func scrollingUpThroughRealSafeAreasHasZeroOverlapAndZeroJump() throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let test = TestStorage()
        defer { test.remove() }
        let context = makeContext(test)

        var timeline = ChatTimeline()
        for run in 0..<8 {
            let longPrompt = (1...14).map { "Line \($0) of a long prompt for run \(run) that forces UserBubble folding." }.joined(separator: "\n")
            let answer = """
                Haha, honestly that is the exact right reaction — let me give you the full plain English breakdown for run \(run) so you can see every piece clearly before live users touch it.

                ---

                ## 1. First: How Did This Happen in ~7 Hours? (Why It Feels Unreal)

                We didn't have one slow agent typing file by file. We ran 33 dedicated agents in structured parallel waves across ~7 hours:

                - **14 builders** working simultaneously in separate folders so 3–4 full systems were built at the exact same time.
                - **11 deep reviewers** whose job was to break what the builders wrote and catch real bugs by booting every service.
                """
            timeline.add([
                Item.user("u\(run)", longPrompt),
                Item.thinking("th\(run)", "Thinking through run \(run) step by step."),
                Item.text("t\(run)", answer),
            ])
        }
        timeline.close(live: false)
        let entries = timeline.rows.map { (id: $0.id, entry: TranscriptEntry.row($0)) }

        let controller = TranscriptController()
        controller.context = context
        controller.additionalSafeAreaInsets = UIEdgeInsets(top: 56, left: 0, bottom: 120, right: 0)
        let nav = UINavigationController(rootViewController: controller)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 393, height: 852)
        window.rootViewController = nav
        window.isHidden = false
        defer { window.isHidden = true }

        controller.loadViewIfNeeded()
        controller.setBarInsets(EdgeInsets(top: 110, leading: 0, bottom: 140, trailing: 0))
        controller.show(entries)
        settle(nav.view)
        controller.setFollowing(false)

        let view = controller.collectionView
        let layout = try #require(view.transcriptLayout)
        let start = view.contentOffset.y
        var worstJump: CGFloat = 0
        var worstJumpInfo = ""
        var worstOverlap: CGFloat = 0
        var worstContentSizeError: CGFloat = 0

        for step in 0..<140 {
            let before = screenPositions(view)
            let beforeOffset = view.contentOffset.y
            view.contentOffset.y = max(view.minOffset, view.contentOffset.y - 37)
            settle(view)

            let expectedContentHeight = layout.contentHeight + layout.tailSpacer
            worstContentSizeError = max(worstContentSizeError, abs(view.contentSize.height - expectedContentHeight))

            let sortedVisible = view.visibleCells
                .compactMap { cell -> (item: Int, cell: UICollectionViewCell)? in
                    guard let path = view.indexPath(for: cell) else { return nil }
                    return (path.item, cell)
                }
                .sorted { $0.item < $1.item }

            for pair in zip(sortedVisible, sortedVisible.dropFirst()) {
                #expect(pair.0.cell.safeAreaInsets == .zero, "hosted cell must never inherit safe area")
                let overlap = pair.0.cell.frame.maxY - pair.1.cell.frame.minY
                worstOverlap = max(worstOverlap, overlap)
            }

            if view.contentOffset.y > view.minOffset + 1 {
                for (id, y) in screenPositions(view) {
                    guard let old = before[id] else { continue }
                    let diff = abs(y - (old + 37))
                    if diff > worstJump {
                        worstJump = diff
                        worstJumpInfo = "step=\(step) id=\(id) old=\(old) new=\(y) off=\(beforeOffset)->\(view.contentOffset.y)"
                    }
                }
            }
        }

        #expect(view.safeAreaInsets == .zero)
        #expect(start - view.contentOffset.y > 4000)
        #expect(worstOverlap <= 0.5, "adjacent cells overlapped by \(worstOverlap) pt")
        #expect(worstJump < 1, "row shifted by \(worstJump) pt beyond scroll (\(worstJumpInfo))")
        #expect(worstContentSizeError < 1, "collectionView.contentSize drifted from layout by \(worstContentSizeError) pt")
    }

    @Test func anchoringSentPromptHoldsPromptAtTopWhileReplyStreams() throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let test = TestStorage()
        defer { test.remove() }
        let context = makeContext(test)

        var timeline = ChatTimeline()
        for run in 0..<5 {
            let body = (1...6).map { "Existing paragraph \($0) of run \(run)." }.joined(separator: "\n\n")
            timeline.add([Item.user("u\(run)", "Earlier prompt \(run)"), Item.text("t\(run)", body)])
        }
        let sentID = ChatTimeline.userRowID("req-1", clientRequestId: "req-1")
        timeline.add([Item.user("u-sent", "My new prompt", request: "req-1")])
        timeline.close(live: true)
        var entries = timeline.rows.map { (id: $0.id, entry: TranscriptEntry.row($0)) }
        entries.append((TranscriptEntry.laneID, .lane(.starting, startedAt: nil)))

        let controller = TranscriptController()
        controller.context = context
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 393, height: 852)
        window.rootViewController = controller
        window.isHidden = false
        defer { window.isHidden = true }

        controller.loadViewIfNeeded()
        controller.setBarInsets(EdgeInsets(top: 100, leading: 0, bottom: 140, trailing: 0))
        controller.show(entries)
        settle(controller.view)

        controller.jump(TranscriptJump(id: 1, kind: .anchorPrompt(sentID)))
        // Complete jump immediately for deterministic measurement.
        controller.collectionView.endAnimatingToEnd()
        settle(controller.view)

        let view = controller.collectionView
        let layout = try #require(view.transcriptLayout)
        let promptPath = try #require(view.indexPathForID(sentID))
        let initialPromptFrame = try #require(layout.layoutAttributesForItem(at: promptPath)?.frame)
        let initialScreenY = initialPromptFrame.minY - view.contentOffset.y
        #expect(abs(initialScreenY - view.adjustedContentInset.top) < 2, "sent prompt should sit at top of visible viewport")
        #expect(layout.tailSpacer > 200, "tail spacer should reserve open space below the sent prompt")

        // Stream several paragraphs: prompt must stay rock-steady at top while tailSpacer shrinks.
        var streamed = ""
        for step in 1...4 {
            streamed += (step == 1 ? "" : "\n\n") + "Streamed paragraph \(step): clear, calm downward growth into open space."
            var nextTimeline = ChatTimeline()
            for run in 0..<5 {
                let body = (1...6).map { "Existing paragraph \($0) of run \(run)." }.joined(separator: "\n\n")
                nextTimeline.add([Item.user("u\(run)", "Earlier prompt \(run)"), Item.text("t\(run)", body)])
            }
            nextTimeline.add([Item.user("u-sent", "My new prompt", request: "req-1")])
            nextTimeline.addLive(
                items: [],
                blocks: [OpenBlock(blockId: "b1", messageId: "m1", kind: .text, parentToolCallId: nil, text: streamed)],
                tools: [])
            nextTimeline.close(live: true)
            var nextEntries = nextTimeline.rows.map { (id: $0.id, entry: TranscriptEntry.row($0)) }
            nextEntries.append((TranscriptEntry.laneID, .lane(.working, startedAt: nil)))

            let spacerBefore = layout.tailSpacer
            controller.show(nextEntries)
            settle(controller.view)

            let promptFrame = try #require(layout.layoutAttributesForItem(at: promptPath)?.frame)
            let screenY = promptFrame.minY - view.contentOffset.y
            #expect(abs(screenY - initialScreenY) < 2, "sent prompt moved during streaming at step \(step)")
            #expect(layout.tailSpacer < spacerBefore, "tail spacer should shrink as reply grows")
        }
    }

    @Test func streamingPacerSnapsOnFlushAndHandlesReset() {
        let pacer = StreamingPacer()
        let block = OpenBlock(blockId: "b1", messageId: "m1", kind: .text, parentToolCallId: nil, text: "Hello world, this is a longer burst of streamed text.")
        let initial = pacer.sync([block], animated: true)
        let shown = initial.first?.text ?? ""
        #expect(!shown.isEmpty && shown.count < block.text.count && block.text.hasPrefix(shown))

        pacer.flush()
        let flushed = pacer.sync([block], animated: true)
        #expect(flushed.first?.text == block.text)

        let replaced = OpenBlock(blockId: "b1", messageId: "m1", kind: .text, parentToolCallId: nil, text: "Completely different text")
        let afterReset = pacer.sync([replaced], animated: true)
        #expect(afterReset.first?.text == replaced.text)
        pacer.stop()
    }

    private func makeContext(_ test: TestStorage) -> TranscriptCellContext {
        TranscriptCellContext(
            app: AppModel(storage: test.storage), disclosure: Disclosure(), images: nil, formatContext: nil, machineId: nil,
            openRoute: OpenRouteAction { _ in }, answerSource: AnswerSource { _ in nil }, modelNames: ModelNames { _ in nil },
            retryHistory: {})
    }

    private func screenPositions(_ view: TranscriptCollectionView) -> [String: CGFloat] {
        var positions: [String: CGFloat] = [:]
        for cell in view.visibleCells {
            guard let path = view.indexPath(for: cell), let id = view.itemID(path) else { continue }
            let frame = cell.frame
            if frame.maxY > view.contentOffset.y, frame.minY < view.contentOffset.y + view.bounds.height {
                positions[id] = frame.minY - view.contentOffset.y
            }
        }
        return positions
    }

    private func settle(_ view: UIView) {
        for _ in 0..<3 {
            RunLoop.main.run(until: Date().addingTimeInterval(0.01))
            view.layoutIfNeeded()
        }
    }
}
