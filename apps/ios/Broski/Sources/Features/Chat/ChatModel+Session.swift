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

    func setModel(_ modelId: String) async {
        do throws(ChatProblem) { try await requests.setModel(session, modelId) } catch { report(error) }
    }

    func setThinking(_ value: String) async {
        do throws(ChatProblem) { try await requests.setThinking(session, value) } catch { report(error) }
    }

    func setMode(axis: String, value: String) async {
        do throws(ChatProblem) { try await requests.setMode(session, axis: axis, value: value) } catch { report(error) }
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
