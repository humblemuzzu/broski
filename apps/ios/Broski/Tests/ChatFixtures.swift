import BroskiCore
import Foundation

@testable import Broski

/// Transcript items as the contract shapes them, for the chat's tests.
enum Item {
    static func user(_ id: String, _ text: String, at: Int64? = nil, request: String? = nil) -> TranscriptItem {
        .userMessage(UserMessageItem(id: id, at: at, text: text, attachments: [], clientRequestId: request))
    }

    static func text(_ id: String, _ text: String, message: String = "m", at: Int64? = nil) -> TranscriptItem {
        .block(BlockItem(id: id, at: at, messageId: message, block: .text, text: text, parentToolCallId: nil))
    }

    static func thinking(_ id: String, _ text: String, at: Int64? = nil) -> TranscriptItem {
        .block(BlockItem(id: id, at: at, messageId: "m", block: .thinking, text: text, parentToolCallId: nil))
    }

    static func call(_ id: String, _ name: String, _ input: [String: String] = [:], parent: String? = nil, at: Int64? = nil) -> TranscriptItem {
        .toolCall(ToolCallItem(
            id: id, at: at, toolCallId: id, messageId: "m", name: name, title: nil, input: .arguments(input),
            parentToolCallId: parent, childSession: nil))
    }

    static func result(
        _ id: String, _ outcome: ToolOutcome = .completed, output: String = "", exitCode: Int64? = nil,
        changes: [FileChange] = [], at: Int64? = nil
    ) -> TranscriptItem {
        .toolResult(ToolResultItem(
            id: "\(id):result", at: at, toolCallId: id, outcome: outcome,
            result: ToolResult(content: output.isEmpty ? [] : [.text(TextContent(text: output))], fileChanges: changes, error: nil, exitCode: exitCode, display: nil)))
    }

    static func notice(_ id: String, _ text: String) -> TranscriptItem {
        .notice(NoticeItem(id: id, at: nil, level: .info, text: text))
    }

    static func activity(_ id: String, _ title: String, kind: ActivityKind = .task) -> TranscriptItem {
        .activity(ActivityItem(
            id: id, at: nil,
            activity: Activity(
                kind: kind, title: title, status: nil, command: nil, durationMs: nil, exitCode: nil, body: nil,
                childSession: nil)))
    }
}

extension JsonValue {
    static func arguments(_ values: [String: String]) -> JsonValue? {
        values.isEmpty ? nil : .object(values.sorted { $0.key < $1.key }.map { JsonMember(key: $0.key, value: .string($0.value)) })
    }
}

extension FileChange {
    static func modified(_ path: String) -> FileChange {
        FileChange(path: path, change: .modified, previousPath: nil, diff: "@@ -1 +1 @@\n-one\n+two\n", additions: 1, deletions: 1)
    }
}

/// A timeline over items, as the chat builds one.
func rows(_ items: [TranscriptItem], live: Bool = false) -> [ChatRow] {
    var timeline = ChatTimeline()
    timeline.add(items)
    timeline.close(live: live)
    return timeline.rows
}

extension ChatRow {
    /// A short name of what the row holds, so a test reads the transcript's shape at a glance.
    var shape: String {
        switch content {
        case .user(let turn): "user:\(turn.text)"
        case .pending(let prompt): "pending:\(prompt.draft.text)"
        case .work(let fold): "work:\(fold.summary.text)\(fold.summary.failedText.map { " · \($0)" } ?? "")"
        case .text: "text"
        case .answerEnd: "end"
        case .notice(let notice): "notice:\(notice.text)"
        case .activity(let entry): "activity:\(entry.item.activity.title)"
        case .marker: "marker"
        }
    }
}
