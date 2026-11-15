import BroskiCore
import Foundation

@testable import Broski

/// A session view whose updates the test hands over one at a time, standing in for the core's
/// (UniFFI's mock constructor: no Rust object behind it). `detach()` ends the pull, as the core's does.
nonisolated final class ScriptedSessionView: SessionView, @unchecked Sendable {
    private let lock = NSLock()
    private var queued: [SessionUpdate] = []
    private var waiter: CheckedContinuation<SessionUpdate?, Never>?
    private var detached = false

    init() {
        super.init(noHandle: NoHandle())
    }

    required init(unsafeFromHandle handle: UInt64) {
        fatalError("a scripted view has no Rust object")
    }

    var isDetached: Bool { lock.withLock { detached } }

    func push(_ update: SessionUpdate) {
        let waiting: CheckedContinuation<SessionUpdate?, Never>? = lock.withLock {
            guard let waiter else {
                queued.append(update)
                return nil
            }
            self.waiter = nil
            return waiter
        }
        waiting?.resume(returning: update)
    }

    override func nextUpdate() async -> SessionUpdate? {
        await withCheckedContinuation { continuation in
            let ready: SessionUpdate?? = lock.withLock {
                if !queued.isEmpty { return .some(queued.removeFirst()) }
                if detached { return .some(nil) }
                waiter = continuation
                return nil
            }
            if let ready { continuation.resume(returning: ready) }
        }
    }

    override func detach() {
        let waiting: CheckedContinuation<SessionUpdate?, Never>? = lock.withLock {
            detached = true
            defer { waiter = nil }
            return waiter
        }
        waiting?.resume(returning: nil)
    }
}

/// Answers the chat's requests as a test says, keeping every request it was sent. A transcript
/// read can be held until the test lets it through.
final class ScriptedChat {
    private(set) var sent: [ClientMessage] = []
    var page = TranscriptPage(items: [], nextCursor: nil, idStability: .stable)
    var promptResult: PromptResult = .accepted(PromptAccepted(disposition: .started, queueItemId: nil))
    var answerResult: ActionResult = .accepted(ActionAccepted())
    private var held: CheckedContinuation<Void, Never>?
    var holdsTranscript = false

    var requests: ChatRequests {
        ChatRequests { [self] message in
            sent.append(message)
            return await answer(message)
        }
    }

    var prompts: [PromptInput] {
        sent.compactMap { if case .prompt(let request) = $0 { request.input } else { nil } }
    }

    var answers: [InteractionAnswer] {
        sent.compactMap { if case .interactionAnswer(let request) = $0 { request.answer } else { nil } }
    }

    var transcriptReads: Int {
        sent.count { if case .transcriptRead = $0 { true } else { false } }
    }

    func release() {
        held?.resume()
        held = nil
    }

    private func answer(_ message: ClientMessage) async -> ServerMessage {
        switch message {
        case .transcriptRead:
            if holdsTranscript { await withCheckedContinuation { held = $0 } }
            return .transcriptReadResult(TranscriptReadResponse(requestId: "", result: .accepted(TranscriptRead(page: page))))
        case .prompt:
            return .promptResult(PromptResponse(requestId: "", result: promptResult))
        case .interactionAnswer:
            return .interactionAnswerResult(InteractionAnswerResponse(requestId: "", result: answerResult))
        default:
            return .abortResult(AbortResponse(requestId: "", result: .accepted(ActionAccepted())))
        }
    }
}
