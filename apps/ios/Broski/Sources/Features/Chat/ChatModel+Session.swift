import BroskiCore

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

    /// The conversation as plain text, as far as it is loaded: each message of the person's and
    /// each of the agent's answers, oldest first.
    var conversationText: String {
        let items = history.items + (snapshot.run?.items ?? [])
        return items.compactMap { item -> String? in
            switch item {
            case .userMessage(let message): "You: \(message.text)"
            case .block(let block) where block.block == .text && block.parentToolCallId == nil: block.text
            default: nil
            }
        }
        .joined(separator: "\n\n")
    }
}
