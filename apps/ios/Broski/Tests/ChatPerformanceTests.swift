import BroskiCore
import XCTest

@testable import Broski

/// What the chat does per streamed batch (at most 30 a second, mobile-core.md) over a run at the
/// contract's bound of 1,000 items: rebuild the live rows. The
/// budget is the frame: a batch has to cost far less than 8 ms to leave a 120 Hz frame its drawing.
nonisolated final class ChatPerformanceTests: XCTestCase {
    /// 1,000 items: 200 turns of a message, a thought, a command and its result, and an answer.
    @MainActor private static let items: [TranscriptItem] = (0..<200).flatMap { turn -> [TranscriptItem] in
        let at = Int64(turn) * 10_000
        return [
            Item.user("u\(turn)", "Step \(turn): run the tests and fix what fails", at: at),
            Item.thinking("t\(turn)", "Reading the failures first.", at: at + 1_000),
            Item.call("c\(turn)", "bash", ["command": "npm test -- --grep step\(turn)"], at: at + 2_000),
            Item.result("c\(turn)", output: "ok", at: at + 3_000),
            Item.text("b\(turn)", "Fixed **step \(turn)**: the `fixture` was stale.\n\n- reran the suite\n- all green", at: at + 4_000),
        ]
    }

    @MainActor
    func testABatchOfAThousandItemRunRebuildsWellInsideAFrame() {
        var open = "The answer streams"
        _ = rebuild(open)
        measure(metrics: [XCTClockMetric(), XCTCPUMetric()]) {
            for _ in 0..<30 {
                open += " and grows by a few words each batch, the way a model writes."
                _ = rebuild(open)
            }
        }
    }

    @MainActor
    private func rebuild(_ open: String) -> [ChatRow] {
        var timeline = ChatTimeline()
        let block = OpenBlock(blockId: "open", messageId: "m", kind: .text, parentToolCallId: nil, text: open)
        timeline.addLive(items: Self.items, blocks: [block], tools: [])
        timeline.close(live: true)
        return timeline.rows
    }
}
