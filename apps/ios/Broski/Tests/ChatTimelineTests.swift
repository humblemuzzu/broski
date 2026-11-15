import BroskiCore
import Foundation
import Testing

@testable import Broski

/// The transcript's rows from contract items: one fold per stretch of work, its line from what the
/// calls did, the agent's text block by block, and the quiet line under a finished answer.
@Suite
struct ChatTimelineTests {
    @Test func aTurnFoldsItsWorkIntoOneLineAboveTheAnswer() {
        let built = rows([
            Item.user("u1", "Fix the test", at: 0),
            Item.thinking("t1", "Looking", at: 1_000),
            Item.call("c1", "read", ["path": "/w/notes.md"], at: 2_000),
            Item.result("c1", at: 3_000),
            Item.call("c2", "bash", ["command": "npm test"], at: 4_000),
            Item.result("c2", .failed, output: "1 failing", exitCode: 1, at: 125_000),
            Item.text("b1", "Fixed it.", at: 126_000),
        ])
        #expect(built.map(\.shape) == [
            "user:Fix the test", "work:Worked for 2m · Ran 1 command · Read 1 file · 1 failed", "text:p-0", "end",
        ])
        guard case .work(let fold) = built[1].content, case .answerEnd(let end) = built[3].content else {
            Issue.record("expected a fold and an answer's end")
            return
        }
        #expect(fold.entries.map(\.id) == ["t1", "c1", "c2"], "the thought and the calls, in order")
        #expect(fold.tools[1].output == "1 failing" && fold.tools[1].failed)
        #expect(end.text == "Fixed it." && end.at == 126_000)
    }

    @Test func workBetweenTheAgentsWordsIsAContinuationAndAResultFindsItsEarlierCall() {
        let built = rows([
            Item.user("u1", "Go"),
            Item.call("c1", "edit", ["path": "a.swift"]),
            Item.text("b1", "Editing while it runs."),
            Item.result("c1", changes: [.modified("a.swift")]),
            Item.call("c2", "grep", ["pattern": "x"]),
            Item.call("c3", "grep", ["pattern": "y"], parent: "c2"),
            Item.result("c2"),
            Item.text("b2", "Done."),
        ])
        #expect(built.map(\.shape) == ["user:Go", "work:Edited 1 file", "text:p-0", "work:Searched 1 time", "text:p-0", "end"])
        guard case .work(let first) = built[1].content, case .work(let second) = built[3].content else {
            Issue.record("expected two folds")
            return
        }
        #expect(first.tools[0].fileChanges.map(\.path) == ["a.swift"], "the result reached the call's fold")
        #expect(!first.isContinuation && second.isContinuation)
        #expect(second.tools.count == 2, "a nested call is listed, not counted")
    }

    @Test func theAgentsTextIsOneRowPerMarkdownBlockKeyedByWhereItStarts() {
        let built = rows([Item.user("u1", "List them"), Item.text("b1", "# Steps\n\nFirst this:\n\n- one\n- two")])
        let pieces = built.compactMap { if case .text(let piece) = $0.content { piece } else { nil } }
        #expect(pieces.map(\.block.key) == markdownBlocks(text: "# Steps\n\nFirst this:\n\n- one\n- two").map(\.key))
        #expect(built.map(\.id).filter { $0.hasPrefix("b1/") }.count == pieces.count)
        #expect(pieces.first?.isFirst == true && pieces.dropFirst().allSatisfy { !$0.isFirst })
        let listGap = built.last { if case .text = $0.content { true } else { false } }?.gap
        #expect(listGap == 6, "a list's items sit closer than paragraphs")
    }

    @Test func aLiveRunsStretchStaysLiveItsAnswerHasNoEndYetAndItsOpenBlockStreams() {
        var timeline = ChatTimeline { _, text in markdownBlocks(text: text) }
        let tool = RunningTool(
            toolCallId: "c1", name: "bash", title: nil, input: .arguments(["command": "make"]), messageId: "m",
            parentToolCallId: nil, childSession: nil, output: "building…", progress: nil, fileChanges: [])
        timeline.addLive(items: [Item.user("u1", "Build"), Item.call("c1", "bash", ["command": "make"])], blocks: [], tools: [tool])
        timeline.close(live: true)
        guard case .work(let fold) = timeline.rows.last?.content else {
            Issue.record("expected the live fold last")
            return
        }
        #expect(fold.isLive && fold.tools[0].isRunning && fold.tools[0].output == "building…")
        #expect(fold.summary.lead == nil, "a live stretch has no duration yet")

        var streaming = ChatTimeline { _, text in markdownBlocks(text: text) }
        let open = OpenBlock(blockId: "b1", messageId: "m", kind: .text, parentToolCallId: nil, text: "One.\n\nTwo is still com")
        streaming.addLive(items: [Item.user("u1", "Write")], blocks: [open], tools: [])
        streaming.close(live: true)
        let pieces = streaming.rows.compactMap { if case .text(let piece) = $0.content { piece } else { nil } }
        #expect(pieces.map(\.isStreaming) == [false, true], "only the open block's last piece streams")
        #expect(!streaming.rows.contains { if case .answerEnd = $0.content { true } else { false } })
    }

    @Test func aPendingPromptFollowsTheRunAndTheLivePartContinuesFromTheHistory() {
        let history = rows([Item.user("u1", "Hi"), Item.text("b1", "Hello.")])
        var live = ChatTimeline(after: history.last) { _, text in markdownBlocks(text: text) }
        live.close(live: false)
        live.append(pending: PendingPrompt(id: "r1", draft: ComposerDraft(text: "Next")))
        let added = live.finished(continuing: history.last)
        #expect(added.map(\.shape) == ["pending:Next"])
        #expect(added[0].gap == 28, "the gap is measured from the last history row")
        #expect(added[0].startsMessage)
    }

    @Test func toolsAreNamedByWhatTheyDidAndTheirLabelIsWhatTheyActedOn() {
        #expect(ToolWork(call: call("Bash", ["command": "ls -la"])).label == "ls -la")
        #expect(ToolWork(call: call("Read", ["file_path": "/w/src/app.ts"])).label == "Read app.ts")
        #expect(ToolWork(call: call("Grep", ["pattern": "TODO"])).label == "Searched TODO")
        #expect(ToolWork(call: call("Task", [:])).kind == .agent)
        #expect(ToolWork(call: call("KillShell", [:])).kind == .command)
        #expect(ToolWork(call: call("mcp__thing", [:])).kind == .other)
    }

    @Test func aCallThatChangedFilesBecomesAnEditOnceItsResultIsIn() {
        var tool = ToolWork(call: call("custom", [:]))
        #expect(tool.kind == .other)
        guard case .toolResult(let result) = Item.result("c", changes: [.modified("/w/a.ts")]) else { fatalError("a result item") }
        tool.finish(with: result)
        #expect(tool.kind == .edit)
        #expect(tool.label == "Edited a.ts")
    }

    @Test func theFoldsLineCountsVerbsMostConsequentialFirstAndFoldsTheRestIntoTools() {
        let tools = [
            FoldTool(id: "1", kind: .edit, paths: ["/a", "/b"]), FoldTool(id: "2", kind: .command, paths: []),
            FoldTool(id: "3", kind: .command, paths: []), FoldTool(id: "4", kind: .command, paths: []),
            FoldTool(id: "5", kind: .read, paths: ["/c"]), FoldTool(id: "6", kind: .web, paths: []),
        ]
        let summary = WorkSummary(counts: foldCounts(tools: tools), failed: 0, thoughts: 0, duration: 42, isContinuation: true)
        #expect(summary.text == "Continued for 42s · Edited 2 files · Ran 3 commands · Used 2 tools")
        #expect(WorkSummary(counts: [], failed: 0, thoughts: 1, duration: 0.4, isContinuation: false).text == "Thought")
        #expect(WorkSummary.format(59) == "59s" && WorkSummary.format(61) == "1m" && WorkSummary.format(3_900) == "1h 5m")
    }

    private func call(_ name: String, _ input: [String: String]) -> ToolCallItem {
        guard case .toolCall(let call) = Item.call("c", name, input) else { fatalError("a call item") }
        return call
    }
}
