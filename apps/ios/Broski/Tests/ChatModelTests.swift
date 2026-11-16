import BroskiCore
import Foundation
import Testing

@testable import Broski

/// The chat's model over a scripted session view and scripted answers: what a prompt shows before
/// and after the agent has it, what stays on screen between a run's end and the newest page, what an
/// answer that lost the race says, and the view detached when the chat goes.
@Suite
struct ChatModelTests {
    private let session = SessionRef(backend: .pi, sessionId: "s1")
    private let capabilities = SessionCapabilities(controllable: true, compact: true, cancelQueued: true, answer: true)

    private func chat(_ machine: ScriptedChat, view: ScriptedSessionView) -> ChatModel {
        ChatModel(
            target: SessionTarget(machineId: "m", session: session), requests: machine.requests, drafts: DraftStore()
        ) { _ in view }
    }

    private func reset(_ snapshot: SessionSnapshot = .empty) -> SessionUpdate {
        .reset(session: session, capabilities: capabilities, snapshot: snapshot, status: .idle)
    }

    /// The transcript reports scrolling from inside layout, which reads `follow`; UIKit lays the app
    /// out again for every change it is told of, so scrolling that changes nothing must tell nobody.
    @Test func scrollingThatChangesNothingAnnouncesNothingSoLayoutCannotSpinOnIt() {
        let chat = chat(ScriptedChat(), view: ScriptedSessionView())
        let announced = Announcements()
        withObservationTracking { _ = chat.follow } onChange: { announced.count += 1 }

        for distance in [0, 0.5, 1] as [CGFloat] {
            chat.updateFollow { $0.scrolled(distanceFromEnd: distance, byPerson: false) }
        }
        chat.updateFollow { $0.scrolled(distanceFromEnd: 300, byPerson: false) }
        chat.updateFollow { $0.appended(messages: 3) }
        #expect(announced.count == 0, "following stays following, and nothing was unseen")

        chat.updateFollow { $0.scrolled(distanceFromEnd: 300, byPerson: true) }
        #expect(announced.count == 1)
        #expect(!chat.follow.isFollowing)
    }

    @Test func aPromptShowsDimmedUntilTheAgentHasItThenItsMessageTakesItsPlace() async throws {
        let machine = ScriptedChat()
        let view = ScriptedSessionView()
        let chat = chat(machine, view: view)
        chat.start()
        view.push(reset())
        try await until { chat.isRevealed }

        chat.draft.text = "  Tidy the notes "
        await chat.send(.send)
        let input = try #require(machine.prompts.first)
        #expect(input.mode == .start && input.text == "Tidy the notes")
        #expect(chat.draft == ComposerDraft(), "the field empties as the prompt goes")
        #expect(chat.liveRows.map(\.shape) == ["pending:  Tidy the notes "], "started, but not delivered yet")

        let run = ActiveRun(runId: "r", trigger: .prompt, startedAt: 0, items: [], droppedItems: 0)
        view.push(.changes(changes: [
            .runChanged(run: run),
            .runItemAppended(item: Item.user("u1", "Tidy the notes", request: input.clientRequestId)),
        ], status: .running))
        try await until { chat.isRunning }
        #expect(chat.pending.isEmpty)
        #expect(chat.liveRows.map(\.shape) == ["user:Tidy the notes"])
    }

    @Test func aQueuedPromptLeavesTheBubbleToTheQueueAndARefusedOneGoesBackIntoTheField() async throws {
        let machine = ScriptedChat()
        let view = ScriptedSessionView()
        let chat = chat(machine, view: view)
        chat.start()
        view.push(reset())
        try await until { chat.isRevealed }

        machine.promptResult = .accepted(PromptAccepted(disposition: .queued, queueItemId: "q1"))
        chat.draft.text = "Later"
        await chat.send(.queue)
        #expect(machine.prompts.last?.mode == .queue)
        #expect(chat.pending.isEmpty && chat.liveRows.isEmpty, "the queue shows it now")

        machine.promptResult = .rejected(Rejected(rejection: Rejection(code: .busy, message: "a run is active")))
        chat.draft.text = "Now"
        await chat.send(.send)
        #expect(chat.draft.text == "Now", "the refused prompt is back in the field")
        #expect(chat.pending.isEmpty)
        #expect(chat.notices.last?.message == ChatProblem(Rejection(code: .busy, message: "")).message)
        #expect(chat.notices.last?.detail == "a run is active")
    }

    @Test func anEndedRunStaysOnScreenUntilTheNewestPageHoldsItAndThatPageIsReadOnce() async throws {
        let machine = ScriptedChat()
        let view = ScriptedSessionView()
        let chat = chat(machine, view: view)
        chat.start()
        let items = [Item.user("u1", "Go"), Item.text("b1", "Gone and back.")]
        let run = ActiveRun(runId: "r", trigger: .prompt, startedAt: 0, items: [items[0]], droppedItems: 0)
        var live = SessionSnapshot.empty
        live.run = run
        view.push(reset(live))
        try await until { chat.isRevealed && chat.liveRows.count == 1 }
        let reads = machine.transcriptReads

        machine.holdsTranscript = true
        machine.page = TranscriptPage(items: items.reversed(), nextCursor: nil, idStability: .stable)
        view.push(.changes(changes: [
            .runItemAppended(item: items[1]), .runChanged(run: nil), .outcomeChanged(outcome: .completed(RunCompleted())),
        ], status: .idle))
        try await until { !chat.isRunning }
        #expect(chat.liveRows.map(\.shape) == ["user:Go", "text:p-0", "end"],
            "the ended run is still shown, finished, with what the batch that ended it added")
        #expect(chat.historyRows.isEmpty)

        machine.release()
        try await until { !chat.historyRows.isEmpty }
        #expect(chat.historyRows.map(\.shape) == ["user:Go", "text:p-0", "end"])
        #expect(chat.liveRows.isEmpty, "nothing shows twice")
        #expect(machine.transcriptReads == reads + 1)
    }

    @Test func returnedInputGoesInFrontOfTheDraftAndAStaleAnswerSaysSo() async throws {
        let machine = ScriptedChat()
        let view = ScriptedSessionView()
        let chat = chat(machine, view: view)
        chat.start()
        view.push(reset())
        try await until { chat.isRevealed }
        chat.draft.text = "then this"
        view.push(.changes(changes: [.inputReturned(texts: ["queued one"])], status: .idle))
        try await until { chat.draft.text != "then this" }
        #expect(chat.draft.text == "queued one\n\nthen this")

        let ask = Interaction(
            id: "i1", runId: "r", createdAt: 0, expiresAt: nil, title: "Pick one", body: nil, blocksRun: true, origin: nil,
            request: .choice(ChoiceRequest(options: [ContractOption(value: "retry", label: "Retry", description: nil)])))
        machine.answerResult = .rejected(Rejected(rejection: Rejection(code: .stale, message: "already resolved")))
        await chat.answer(ask, .choice(ChoiceReply(value: "retry")))
        #expect(machine.answers == [InteractionAnswer(interactionId: "i1", reply: .choice(ChoiceReply(value: "retry")))])
        #expect(chat.answerProblems["i1"]?.message == "Already answered elsewhere.")
        #expect(chat.answering.isEmpty)
    }

    @Test func aDetachedReaderIsToldOfNewMessagesAndNeverScrolled() async throws {
        let machine = ScriptedChat()
        let view = ScriptedSessionView()
        let chat = chat(machine, view: view)
        chat.start()
        view.push(reset())
        try await until { chat.isRevealed }
        chat.updateFollow { $0.scrolled(distanceFromEnd: 500, byPerson: true) }

        let run = ActiveRun(runId: "r", trigger: .external, startedAt: 0, items: [Item.user("u1", "From the terminal")], droppedItems: 0)
        view.push(.changes(changes: [.runChanged(run: run), .blockOpened(block: OpenBlock(
            blockId: "b1", messageId: "m", kind: .text, parentToolCallId: nil, text: "Streaming"))], status: .running))
        try await until { chat.liveRows.count == 2 }
        #expect(!chat.follow.isFollowing && chat.follow.unseen == 2)
        view.push(.changes(changes: [.blockTextChanged(blockId: "b1", text: "Streaming more of the same paragraph")], status: .running))
        try await until { chat.snapshot.blocks.first?.text.hasSuffix("paragraph") == true }
        #expect(chat.follow.unseen == 2, "text growing in an open block is not a new message")
    }

    @Test func theViewIsDetachedWhenTheChatGoes() async throws {
        let view = ScriptedSessionView()
        var chat: ChatModel? = chat(ScriptedChat(), view: view)
        chat?.start()
        view.push(reset())
        try await until { chat?.state.session != nil }
        chat = nil
        try await until { view.isDetached }
    }

    private func until(_ condition: () -> Bool) async throws {
        for _ in 0..<400 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        Issue.record("the condition never held")
        throw CancellationError()
    }
}

/// How many changes observation announced; its `onChange` runs synchronously on the writer's thread.
private nonisolated final class Announcements: @unchecked Sendable {
    var count = 0
}
