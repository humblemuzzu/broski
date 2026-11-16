import BroskiCore
import SwiftUI

/// What a call's result shows in place of its text when its tool has a view of its own: the
/// agent's task list as a checklist, the pages a search found as links, the files a search found,
/// each opening in Files.
struct ToolDisplayView: View {
    let display: ToolDisplay

    /// Files listed in place; the rest are counted.
    static let shownFiles = 20

    var body: some View {
        switch display {
        case .todos(let todos): TodoList(items: todos.items)
        case .links(let links): LinkList(items: links.items)
        case .files(let files): FileList(paths: files.paths, total: files.total)
        }
    }
}

private struct TodoList: View {
    let items: [TodoItem]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs + Spacing.xxs) {
            ForEach(items.indices, id: \.self) { index in
                let item = items[index]
                Label {
                    Text(item.text)
                        .strikethrough(item.status == .completed)
                        .foregroundStyle(item.status == .completed ? .secondary : .primary)
                        .fontWeight(item.status == .inProgress ? .semibold : .regular)
                } icon: {
                    Image(systemName: item.status.symbol)
                        .foregroundStyle(item.status == .inProgress ? Palette.working : .secondary)
                }
                .font(.footnote)
                .accessibilityValue(item.status.words)
            }
        }
    }
}

private struct LinkList: View {
    let items: [LinkItem]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            ForEach(items.indices, id: \.self) { index in
                let item = items[index]
                if let url = URL(string: item.url) {
                    Link(destination: url) {
                        HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                            VStack(alignment: .leading, spacing: 0) {
                                Text(item.title.isEmpty ? item.url : item.title)
                                    .font(.footnote.weight(.medium))
                                    .lineLimit(2)
                                Text(url.host() ?? item.url)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: Spacing.s)
                            Image(systemName: "arrow.up.right")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private struct FileList: View {
    let paths: [String]
    let total: Int64?
    @Environment(\.chatMachineId) private var machineId

    private var more: Int {
        max(Int(total ?? 0), paths.count) - min(paths.count, ToolDisplayView.shownFiles)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            ForEach(paths.prefix(ToolDisplayView.shownFiles), id: \.self) { path in
                if let machineId {
                    NavigationLink(value: Route.workspace(machineId: machineId, place: .file(path))) { row(path) }
                        .buttonStyle(.plain)
                } else {
                    row(path)
                }
            }
            if more > 0 {
                Text("^[\(more) more file](inflect: true)").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func row(_ path: String) -> some View {
        HStack(spacing: Spacing.s) {
            Image(systemName: "doc").font(.caption).foregroundStyle(.secondary).accessibilityHidden(true)
            Text(path.lastPathComponent).font(.footnote.weight(.medium))
            Text(path.parentPath)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.head)
        }
        .contentShape(.rect)
    }
}

extension TodoStatus {
    var symbol: String {
        switch self {
        case .pending: "circle"
        case .inProgress: "circle.dotted.circle"
        case .completed: "checkmark.circle.fill"
        }
    }

    var words: String {
        switch self {
        case .pending: "To do"
        case .inProgress: "In progress"
        case .completed: "Done"
        }
    }
}
