import BroskiCore
import CoreTransferable

/// What the header's overflow and the composer's chips do to the session itself.
extension ChatModel {
    func loadSummary() async {
        if let summary = try? await requests.summary(session) { adopt(summary) }
    }

    /// A copy of the conversation as a new session, to open in its place.
    func fork() async -> SessionRef? {
        do throws(ChatProblem) {
            return try await requests.fork(session)
        } catch {
            report(error)
            return nil
        }
    }

    func delete() async -> Bool {
        do throws(ChatProblem) {
            try await requests.delete(session)
            play(.destructive)
            return true
        } catch {
            report(error)
            return false
        }
    }

    func compact() async {
        do throws(ChatProblem) { try await requests.compact(session) } catch { report(error) }
    }

    /// The model, then the level when one is given: a level is checked against the model the
    /// session runs, so it waits for the model to be set.
    func setModel(_ modelId: String, thinking: String?) async {
        await change(ComposerChoices(modelId: modelId, thinking: thinking)) { [requests, session] () async throws(ChatProblem) in
            try await requests.setModel(session, modelId)
            if let thinking { try await requests.setThinking(session, thinking) }
        }
    }

    func setThinking(_ value: String) async {
        await change(ComposerChoices(thinking: value)) { [requests, session] () async throws(ChatProblem) in
            try await requests.setThinking(session, value)
        }
    }

    func setMode(axis: String, value: String) async {
        await change(ComposerChoices(modes: [axis: value])) { [requests, session] () async throws(ChatProblem) in
            try await requests.setMode(session, axis: axis, value: value)
        }
    }

    /// Shows `choice` at once. The bridge's answer and the session's own report of the change come
    /// on separate paths, so the choice is kept a moment past the answer rather than letting the
    /// old value flash back in between.
    private func change(_ choice: ComposerChoices, _ request: () async throws(ChatProblem) -> Void) async {
        pendingChoice = choice
        do throws(ChatProblem) {
            try await request()
            settlePendingChoice()
            try? await Task.sleep(for: .seconds(1))
        } catch {
            report(error)
        }
        if pendingChoice == choice { pendingChoice = nil }
    }

    /// Drops the shown choice once the session reports all of it.
    func settlePendingChoice() {
        guard let pending = pendingChoice else { return }
        let current = ComposerChoices(snapshot)
        let settled = (pending.modelId.map { $0 == current.modelId } ?? true)
            && (pending.thinking.map { $0 == current.thinking } ?? true)
            && pending.modes.allSatisfy { current.modes[$0.key] == $0.value }
        if settled { pendingChoice = nil }
    }

    /// The conversation as far as it is loaded, to copy or share.
    var conversation: ConversationExport {
        ConversationExport(history: history.items, live: snapshot.run?.items ?? [])
    }
}

/// The conversation as plain text: each message of the person's and each of the agent's answers,
/// oldest first. Holding the items rather than the text, it is cheap to make each time the menu
/// holding it is drawn; the text is built only when the person shares it.
nonisolated struct ConversationExport: Transferable {
    let history: [TranscriptItem]
    let live: [TranscriptItem]

    var text: String {
        (history + live).compactMap { item -> String? in
            switch item {
            case .userMessage(let message): "You: \(message.text)"
            case .block(let block) where block.block == .text && block.parentToolCallId == nil: block.text
            default: nil
            }
        }
        .joined(separator: "\n\n")
    }

    static var transferRepresentation: some TransferRepresentation {
        ProxyRepresentation(exporting: \.text)
    }
}
