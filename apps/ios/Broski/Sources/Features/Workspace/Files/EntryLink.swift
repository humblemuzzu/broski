import BroskiCore
import SwiftUI

/// A folder entry as a row that opens it: folders list, everything else reads. A link opens as a
/// file, and its menu offers to list it as a folder, since the listing does not say where it leads.
struct EntryLink: View {
    let machineId: String
    let entry: FileEntry
    let path: String

    var body: some View {
        NavigationLink(value: Route.workspace(machineId: machineId, place: place)) {
            EntryRow(entry: entry)
        }
        .contextMenu {
            if entry.kind == .symlink {
                NavigationLink(value: Route.workspace(machineId: machineId, place: .folder(path))) {
                    Label("Open as Folder", systemImage: "folder")
                }
            }
            Button("Copy Path", systemImage: "doc.on.doc") {
                UIPasteboard.general.string = path
            }
        }
    }

    private var place: WorkspacePlace {
        entry.kind == .dir ? .folder(path) : .file(path)
    }
}

struct EntryRow: View {
    let entry: FileEntry

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(entry.name)
                    .font(.body)
                    .lineLimit(2)
                    .truncationMode(.middle)
                if let detail {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        } icon: {
            Image(systemName: entry.kind.symbol)
                .foregroundStyle(entry.kind == .dir ? Palette.accent : .secondary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([entry.kind.spokenName, entry.name, detail].compactMap(\.self).joined(separator: ", "))
    }

    private var detail: String? {
        let size = entry.kind == .file ? entry.size?.formatted(.byteCount(style: .file)) : nil
        let modified = entry.modifiedAt.map {
            Date(unixMilliseconds: $0).formatted(.relative(presentation: .named, unitsStyle: .abbreviated))
        }
        let parts = [size, modified].compactMap(\.self)
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

extension FileKind {
    var symbol: String {
        switch self {
        case .dir: "folder.fill"
        case .file: "doc"
        case .symlink: "link"
        case .other: "questionmark.square.dashed"
        }
    }

    var spokenName: String {
        switch self {
        case .dir: "Folder"
        case .file: "File"
        case .symlink: "Link"
        case .other: "Special file"
        }
    }
}
