import BroskiCore
import Foundation

/// One machine's session requests (contract §12.1), each answered with its accepted value or a
/// `ChatProblem`. Prompt and abort reach the bridge only for a session this phone views, so the
/// chat sends them while its view is attached.
struct ChatRequests {
    let send: (ClientMessage) async throws -> ServerMessage

    init(machine: Machine) {
        send = { try await machine.request(message: $0) }
    }

    init(send: @escaping (ClientMessage) async throws -> ServerMessage) {
        self.send = send
    }

    func prompt(_ session: SessionRef, _ input: PromptInput) async throws(ChatProblem) -> PromptAccepted {
        try await ask(.prompt(PromptRequest(requestId: "", session: session, input: input))) {
            if case .promptResult(let answer) = $0 { answer.result } else { nil }
        }
    }

    func abort(_ session: SessionRef) async throws(ChatProblem) {
        _ = try await ask(.abort(AbortRequest(requestId: "", session: session))) {
            if case .abortResult(let answer) = $0 { answer.result } else { nil }
        }
    }

    func answer(_ session: SessionRef, _ answer: InteractionAnswer) async throws(ChatProblem) {
        _ = try await ask(.interactionAnswer(InteractionAnswerRequest(requestId: "", session: session, answer: answer))) {
            if case .interactionAnswerResult(let answer) = $0 { answer.result } else { nil }
        }
    }

    func cancelQueued(_ session: SessionRef, id: String) async throws(ChatProblem) {
        _ = try await ask(.queueCancel(QueueCancelRequest(requestId: "", session: session, queueItemId: id))) {
            if case .queueCancelResult(let answer) = $0 { answer.result } else { nil }
        }
    }

    func setModel(_ session: SessionRef, _ modelId: String) async throws(ChatProblem) {
        _ = try await ask(.modelSet(ModelSetRequest(requestId: "", session: session, modelId: modelId))) {
            if case .modelSetResult(let answer) = $0 { answer.result } else { nil }
        }
    }

    func setThinking(_ session: SessionRef, _ thinking: String) async throws(ChatProblem) {
        _ = try await ask(.thinkingSet(ThinkingSetRequest(requestId: "", session: session, thinking: thinking))) {
            if case .thinkingSetResult(let answer) = $0 { answer.result } else { nil }
        }
    }

    func setMode(_ session: SessionRef, axis: String, value: String) async throws(ChatProblem) {
        _ = try await ask(.modeSet(ModeSetRequest(requestId: "", session: session, axis: axis, value: value))) {
            if case .modeSetResult(let answer) = $0 { answer.result } else { nil }
        }
    }

    func compact(_ session: SessionRef) async throws(ChatProblem) {
        _ = try await ask(.compact(CompactRequest(requestId: "", session: session, instructions: nil))) {
            if case .compactResult(let answer) = $0 { answer.result } else { nil }
        }
    }

    func create(_ backend: BackendId, _ options: NewSessionOptions) async throws(ChatProblem) -> SessionRef {
        try await ask(.sessionCreate(SessionCreateRequest(requestId: "", backend: backend, options: options))) {
            if case .sessionCreateResult(let answer) = $0 { answer.result } else { nil }
        }.session
    }

    func fork(_ session: SessionRef) async throws(ChatProblem) -> SessionRef {
        try await ask(.sessionFork(SessionForkRequest(requestId: "", session: session, at: nil))) {
            if case .sessionForkResult(let answer) = $0 { answer.result } else { nil }
        }.session
    }

    func rename(_ session: SessionRef, to title: String) async throws(ChatProblem) {
        _ = try await ask(.sessionRename(SessionRenameRequest(requestId: "", session: session, title: title))) {
            if case .sessionRenameResult(let answer) = $0 { answer.result } else { nil }
        }
    }

    func delete(_ session: SessionRef) async throws(ChatProblem) {
        _ = try await ask(.sessionDelete(SessionDeleteRequest(requestId: "", session: session))) {
            if case .sessionDeleteResult(let answer) = $0 { answer.result } else { nil }
        }
    }

    func summary(_ session: SessionRef) async throws(ChatProblem) -> SessionSummary {
        try await ask(.sessionGet(SessionGetRequest(requestId: "", session: session))) {
            if case .sessionGetResult(let answer) = $0 { answer.result } else { nil }
        }.summary
    }

    /// One page of finished runs, newest first.
    func transcript(_ session: SessionRef, cursor: String?, limit: Int64) async throws(ChatProblem) -> TranscriptPage {
        let page = PageRequest(cursor: cursor, limit: limit)
        return try await ask(.transcriptRead(TranscriptReadRequest(requestId: "", session: session, page: page))) {
            if case .transcriptReadResult(let answer) = $0 { answer.result } else { nil }
        }.page
    }

    func attachment(_ session: SessionRef, id: String, variant: ImageVariant = .full) async throws(ChatProblem) -> AttachmentRead {
        try await ask(.attachmentRead(AttachmentReadRequest(requestId: "", session: session, attachmentId: id, variant: variant))) {
            if case .attachmentReadResult(let answer) = $0 { answer.result } else { nil }
        }
    }

    private func ask<Answer: ChatResult>(
        _ message: ClientMessage, _ result: (ServerMessage) -> Answer?
    ) async throws(ChatProblem) -> Answer.Accepted {
        let answer: ServerMessage
        do {
            answer = try await send(message)
        } catch {
            throw ChatProblem(error)
        }
        guard let result = result(answer) else {
            throw ChatProblem(message: "Your Mac answered something Broski didn't expect.", detail: "\(answer)")
        }
        return try result.chatAccepted
    }
}

/// A session result union: its accepted value, or the rejection every union shares.
protocol ChatResult {
    associatedtype Accepted
    var chatAccepted: Accepted { get throws(ChatProblem) }
}

extension PromptResult: ChatResult {
    var chatAccepted: PromptAccepted {
        get throws(ChatProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw ChatProblem(rejected.rejection)
            }
        }
    }
}

extension ActionResult: ChatResult {
    var chatAccepted: ActionAccepted {
        get throws(ChatProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw ChatProblem(rejected.rejection)
            }
        }
    }
}

extension NewSessionResult: ChatResult {
    var chatAccepted: NewSessionAccepted {
        get throws(ChatProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw ChatProblem(rejected.rejection)
            }
        }
    }
}

extension SessionGetResult: ChatResult {
    var chatAccepted: SessionFound {
        get throws(ChatProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw ChatProblem(rejected.rejection)
            }
        }
    }
}

extension TranscriptReadResult: ChatResult {
    var chatAccepted: TranscriptRead {
        get throws(ChatProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw ChatProblem(rejected.rejection)
            }
        }
    }
}

extension AttachmentReadResult: ChatResult {
    var chatAccepted: AttachmentRead {
        get throws(ChatProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw ChatProblem(rejected.rejection)
            }
        }
    }
}
