import BroskiCore
import Foundation

/// One tool call as the work fold shows it: from its call item (or the running tool), its result
/// once it has one.
nonisolated struct ToolWork: Equatable, Identifiable {
    let id: String
    let name: String
    let title: String?
    var input: JsonValue? { didSet { look = readLook() } }
    let parentToolCallId: String?
    var childSession: SessionRef? { didSet { look = readLook() } }
    var output: String
    var progress: String?
    var fileChanges: [FileChange] { didSet { look = readLook() } }
    /// How the core reads the call: its kind, row label and command.
    private(set) var look: ToolLook
    var outcome: ToolOutcome?
    var error: String?
    var exitCode: Int64?
    /// What the result shows in place of its text, when its tool has a view of its own.
    var display: ToolDisplay?
    var images: [ImageRef]
    var isRunning: Bool

    init(call: ToolCallItem) {
        id = call.toolCallId
        name = call.name
        title = call.title
        input = call.input
        parentToolCallId = call.parentToolCallId
        childSession = call.childSession
        output = ""
        fileChanges = []
        images = []
        isRunning = false
        look = Self.read(name: call.name, title: call.title, input: call.input, childSession: call.childSession, fileChanges: [])
    }

    init(running tool: RunningTool) {
        id = tool.toolCallId
        name = tool.name
        title = tool.title
        input = tool.input
        parentToolCallId = tool.parentToolCallId
        childSession = tool.childSession
        output = tool.output
        progress = tool.progress
        fileChanges = tool.fileChanges
        images = []
        isRunning = true
        look = Self.read(name: tool.name, title: tool.title, input: tool.input, childSession: tool.childSession, fileChanges: tool.fileChanges)
    }

    mutating func finish(with result: ToolResultItem) {
        outcome = result.outcome
        error = result.result.error
        exitCode = result.result.exitCode
        display = result.result.display
        fileChanges = result.result.fileChanges
        isRunning = false
        for content in result.result.content {
            switch content {
            case .text(let text): output += output.isEmpty ? text.text : "\n" + text.text
            case .imageRef(let image): images.append(image)
            case .file: break
            }
        }
    }

    private func readLook() -> ToolLook {
        Self.read(name: name, title: title, input: input, childSession: childSession, fileChanges: fileChanges)
    }

    /// The call as the core reads it, for its row, its arguments and its result.
    var facts: ToolFacts {
        ToolFacts(name: name, title: title, input: input, hasChildSession: childSession != nil, changedPaths: fileChanges.map(\.path))
    }

    private static func read(name: String, title: String?, input: JsonValue?, childSession: SessionRef?, fileChanges: [FileChange]) -> ToolLook {
        toolLook(facts: ToolFacts(name: name, title: title, input: input, hasChildSession: childSession != nil, changedPaths: fileChanges.map(\.path)))
    }

    var kind: ToolKind { look.kind }

    var label: String { look.label }

    var failed: Bool { outcome == .failed || (exitCode ?? 0) != 0 }
}

/// A reasoning block, shown as a row: "Thinking" while it streams, "Thought" once done.
nonisolated struct ThinkingWork: Equatable, Identifiable {
    let id: String
    let text: String
    let isOpen: Bool
}

nonisolated enum WorkEntry: Equatable, Identifiable {
    case tool(ToolWork)
    case thinking(ThinkingWork)

    var id: String {
        switch self {
        case .tool(let tool): tool.id
        case .thinking(let thinking): thinking.id
        }
    }
}

extension ToolKind {
    var symbol: String {
        switch self {
        case .edit: "pencil"
        case .command: "terminal"
        case .agent: "person.2"
        case .read: "doc.text"
        case .search: "magnifyingglass"
        case .web: "globe"
        case .other: "wrench.and.screwdriver"
        }
    }
}
