import BroskiCore
import Foundation

/// One tool call as the work fold shows it: from its call item (or the running tool), its result
/// once it has one.
nonisolated struct ToolWork: Equatable, Identifiable {
    let id: String
    let name: String
    let title: String?
    var input: JsonValue?
    let parentToolCallId: String?
    var childSession: SessionRef?
    var output: String
    var progress: String?
    var fileChanges: [FileChange]
    var outcome: ToolOutcome?
    var error: String?
    var exitCode: Int64?
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
    }

    mutating func finish(with result: ToolResultItem) {
        outcome = result.outcome
        error = result.result.error
        exitCode = result.result.exitCode
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

    var kind: ToolKind { ToolKind(name: name, childSession: childSession, fileChanges: fileChanges) }

    var failed: Bool { outcome == .failed || (exitCode ?? 0) != 0 }

    /// The command a command tool ran, exactly as the agent wrote it.
    var command: String? { input?.text(["command", "cmd", "script"]) }

    /// The row's one line: the tool's own title, else what it acted on.
    var label: String {
        if let title, !title.isEmpty { return title }
        switch kind {
        case .command: return command ?? name
        case .read: return "Read \(target ?? name)"
        case .edit: return "Edited \(target ?? name)"
        case .search: return "Searched \(input?.text(["pattern", "query", "glob", "path"]) ?? name)"
        case .web: return input?.text(["url", "query"]) ?? name
        case .agent: return input?.text(["description", "prompt"]) ?? "Subagent"
        case .other: return [name, input?.text(["path", "file_path", "query", "description"])].compactMap(\.self).joined(separator: " ")
        }
    }

    private var target: String? {
        let path = input?.text(["file_path", "path", "filePath", "notebook_path"]) ?? fileChanges.first?.path
        return path.map { ($0 as NSString).lastPathComponent }
    }
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

/// What a tool did, for the fold's verbs and the row's icon. Read from the call's name and what it
/// produced, which both agents name plainly (`bash`/`Bash`, `read`/`Read`, …).
nonisolated enum ToolKind: CaseIterable {
    case edit
    case command
    case agent
    case read
    case search
    case web
    case other

    init(name: String, childSession: SessionRef?, fileChanges: [FileChange]) {
        let name = name.lowercased()
        if childSession != nil || ["task", "agent", "subagent"].contains(name) {
            self = .agent
        } else if !fileChanges.isEmpty || ["edit", "write", "multiedit", "notebookedit", "patch", "apply_patch"].contains(name) {
            self = .edit
        } else if ["bash", "shell", "exec", "bashoutput", "killshell", "terminal"].contains(name) {
            self = .command
        } else if ["read", "view", "cat", "notebookread"].contains(name) {
            self = .read
        } else if ["grep", "glob", "find", "ls", "search", "list"].contains(name) {
            self = .search
        } else if ["webfetch", "websearch", "fetch"].contains(name) {
            self = .web
        } else {
            self = .other
        }
    }

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

    /// "Read 3 files", "Ran 1 command".
    func phrase(_ count: Int) -> String {
        let many = count != 1
        return switch self {
        case .edit: "Edited \(count) \(many ? "files" : "file")"
        case .command: "Ran \(count) \(many ? "commands" : "command")"
        case .agent: "Ran \(count) \(many ? "subagents" : "subagent")"
        case .read: "Read \(count) \(many ? "files" : "file")"
        case .search: "\(count) \(many ? "searches" : "search")"
        case .web: "Fetched \(count) \(many ? "pages" : "page")"
        case .other: "Used \(count) \(many ? "tools" : "tool")"
        }
    }
}
