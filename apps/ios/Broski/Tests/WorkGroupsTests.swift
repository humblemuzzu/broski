import BroskiCore
import Foundation
import Testing

@testable import Broski

/// A turn's work folding into one line above its answer: where the line stands, what it says and
/// how long, what it leaves out, and what the transcript draws of it.
@Suite
struct WorkGroupsTests {
    /// Thinking, a note, a read, another note, a command and the answer, over 2m 20s.
    private let longTurn: [TranscriptItem] = [
        Item.user("u1", "Go", at: 0),
        Item.thinking("t1", "Plan", at: 1_000),
        Item.text("b1", "Let me look.", at: 2_000),
        Item.call("c1", "read", ["path": "/w/a.md"], at: 3_000),
        Item.result("c1", at: 4_000),
        Item.text("b2", "Now the fix.", at: 5_000),
        Item.call("c2", "bash", ["command": "make"], at: 6_000),
        Item.result("c2", at: 134_000),
        Item.text("b3", "Done.", at: 140_000),
    ]

    private func kinds(_ rows: [ChatRow]) -> [ChatRow.Kind] { rows.map(\.kind) }

    @Test func aTurnsStretchesAndNotesFoldUnderOneLineFromTheMessageToTheLastCall() {
        let built = rows(longTurn)
        #expect(kinds(built) == [.message, .group, .work, .text, .work, .text, .work, .text, .answerEnd])
        #expect(built[1].shape == "group:5:Worked for 2m · Ran 1 command · Read 1 file")
        guard case .answerEnd(let end) = built.last?.content else {
            Issue.record("expected the answer's end")
            return
        }
        #expect(end.text == "Done.", "what a copy takes is the answer, not the notes before it")
    }

    @Test func oneStretchBeforeTheAnswerIsAlreadyOneLine() {
        let built = rows([
            Item.user("u1", "Go", at: 0), Item.call("c1", "read", ["path": "/w/a.md"], at: 1_000), Item.result("c1", at: 2_000),
            Item.text("b1", "It says hi.", at: 3_000),
        ])
        #expect(kinds(built) == [.message, .work, .text, .answerEnd])
    }

    @Test func aStretchOfOnlyReasoningThenAnAnswerStaysAThought() {
        let built = rows([Item.user("u1", "Why", at: 0), Item.thinking("t1", "Hmm", at: 12_000), Item.text("b1", "Because.", at: 13_000)])
        #expect(built.map(\.shape) == ["user:Why", "work:Thought for 12s", "text", "end"])
    }

    @Test func aTurnThatEndsOnACallFoldsAllOfItAndHasNoAnswer() {
        let built = rows([
            Item.user("u1", "Go", at: 0), Item.text("b1", "Checking.", at: 1_000), Item.call("c1", "read", ["path": "a"], at: 2_000),
            Item.call("c2", "bash", ["command": "ls"], at: 3_000), Item.result("c2", at: 9_000),
        ])
        #expect(kinds(built) == [.message, .group, .text, .work])
        let drawn = WorkGroups.shown(built, collapsing: true) { _ in false }.rows
        #expect(kinds(drawn) == [.message, .group])
    }

    @Test func aNoteOrAnActivityEndsAStretchSoAnAnswerBeforeItIsNeverFolded() {
        let built = rows([
            Item.user("u1", "Go", at: 0), Item.call("c1", "read", ["path": "a"], at: 1_000), Item.text("b1", "Started.", at: 2_000),
            Item.call("c2", "bash", ["command": "ls"], at: 3_000), Item.notice("n1", "Rate limited", at: 4_000),
            Item.call("c3", "grep", ["pattern": "x"], at: 5_000), Item.text("b2", "Done.", at: 6_000),
        ])
        #expect(kinds(built) == [.message, .group, .work, .text, .work, .notice, .work, .text, .answerEnd])
        let drawn = WorkGroups.shown(built, collapsing: true) { _ in false }.rows
        #expect(kinds(drawn) == [.message, .group, .notice, .work, .text, .answerEnd])

        let activity = rows([
            Item.user("u1", "Run it"), Item.call("c1", "bash", ["command": "make"]), Item.text("b1", "Building."),
            Item.activity("a1", "make finished"), Item.call("c2", "read", ["path": "log"]), Item.text("b2", "Clean."),
        ])
        #expect(!activity.contains { $0.kind == .group }, "each side of the activity is one stretch and one answer")
    }

    @Test func eachTurnFoldsOnItsOwn() {
        let turn = { (n: Int) -> [TranscriptItem] in
            [
                Item.user("u\(n)", "Go", at: Int64(n) * 1_000_000), Item.call("a\(n)", "read", ["path": "x"], at: Int64(n) * 1_000_000 + 1_000),
                Item.text("n\(n)", "Next.", at: Int64(n) * 1_000_000 + 2_000), Item.call("b\(n)", "bash", ["command": "ls"], at: Int64(n) * 1_000_000 + 3_000),
                Item.text("f\(n)", "Answer \(n)", at: Int64(n) * 1_000_000 + 40_000),
            ]
        }
        let built = rows(turn(1) + turn(2))
        let groups = built.filter { $0.kind == .group }
        #expect(groups.count == 2 && Set(groups.map(\.id)).count == 2)
        #expect(groups.map(\.shape) == ["group:3:Worked for 3s · Ran 1 command · Read 1 file", "group:3:Worked for 3s · Ran 1 command · Read 1 file"])
        #expect(WorkGroups.messageCount(in: built) == 4, "two messages and two answers, not the notes between")
    }

    @Test func aLiveRunsGroupIsLiveWhileItsLastStretchIsAndDoneOnceTheAnswerStreams() {
        let items = [
            Item.user("u1", "Go", at: 0), Item.text("b1", "Let me run it.", at: 1_000), Item.call("c1", "bash", ["command": "make"], at: 2_000),
        ]
        var working = ChatTimeline()
        working.addLive(items: items, blocks: [], tools: [])
        working.close(live: true)
        guard case .group(let live) = working.rows[1].content else {
            Issue.record("expected the group above the live stretch")
            return
        }
        #expect(live.summary.isLive && live.summary.duration == nil)

        var answering = ChatTimeline()
        let open = OpenBlock(blockId: "b2", messageId: "m", kind: .text, parentToolCallId: nil, text: "All gre")
        answering.addLive(items: items + [Item.result("c1", at: 9_000)], blocks: [open], tools: [])
        answering.close(live: true)
        guard case .group(let settled) = answering.rows[1].content else {
            Issue.record("expected the group above the answer")
            return
        }
        #expect(!settled.summary.isLive && settled.summary.text == "Worked for 9s · Ran 1 command")
        #expect(answering.rows.last?.content.isStreamingText == true)
    }

    @Test func aPageCutInsideATurnFoldsWithoutAStartRatherThanStatingAWrongTime() {
        let built = rows([
            Item.call("c1", "read", ["path": "a"], at: 10_000), Item.result("c1", at: 11_000), Item.text("b1", "Now.", at: 12_000),
            Item.call("c2", "bash", ["command": "ls"], at: 13_000), Item.result("c2", at: 20_000), Item.text("b2", "Done.", at: 21_000),
        ])
        #expect(built.first?.shape == "group:3:Ran 1 command · Read 1 file")
    }

    @Test func foldingOffDrawsTheRowsAsTheyWereAndOpeningAGroupDrawsItsRowsBelowIt() {
        let built = rows(longTurn)
        let flat = built.filter { $0.kind != .group }
        #expect(WorkGroups.shown(built, collapsing: false) { _ in true }.rows == flat)

        let closed = WorkGroups.shown(built, collapsing: true) { _ in false }
        #expect(kinds(closed.rows) == [.message, .group, .text, .answerEnd] && closed.revealed.isEmpty)

        let group = built[1]
        let open = WorkGroups.shown(built, collapsing: true) { $0 == group.id }
        #expect(kinds(open.rows) == kinds(built))
        #expect(open.rows[2].gap == 2, "the first of its rows sits close under the line")
        #expect(open.revealed == Set(built[2...6].map(\.id)))
        #expect(open.rows.last == built.last && open.rows[7].gap == built[7].gap, "the answer keeps its place and spacing")
    }

    @Test func aRunsGroupKeepsItsIdWhenTheTranscriptReplacesItsLiveRows() {
        let turn = { (prefix: String) -> [TranscriptItem] in
            [
                Item.user("u", "Go", request: "r1"), Item.text("\(prefix)b1", "Look."), Item.call("\(prefix)c1", "read", ["path": "a"]),
                Item.result("\(prefix)c1"), Item.text("\(prefix)b2", "Done."),
            ]
        }
        let live = rows(turn("live-"))
        let history = rows(turn("saved-"))
        var aliases: [String: String] = [:]
        RowAliases.learn(live: live, history: history, into: &aliases)
        let group = history[1]
        #expect(group.kind == .group && aliases[group.id] == live[1].id)
    }
}

private extension ChatRow.Content {
    var isStreamingText: Bool {
        if case .text(let piece) = self { piece.isStreaming } else { false }
    }
}
