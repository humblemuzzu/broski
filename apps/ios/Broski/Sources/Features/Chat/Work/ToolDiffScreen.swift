import BroskiCore
import SwiftUI

/// The diff of one file a tool call changed, from the change's own patch.
struct ToolDiffScreen: View {
    let change: FileChange
    private let file: DiffFile

    init(change: FileChange) {
        self.change = change
        file = fileChangeDiff(change: change)
    }

    var body: some View {
        DiffView(file: file)
            .navigationTitle(change.path.lastPathComponent)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text(change.path.lastPathComponent).font(.headline).lineLimit(1)
                        Text(change.change.words).font(.caption).foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
    }
}

extension FileChangeKind {
    var words: String {
        switch self {
        case .added: "Added"
        case .deleted: "Deleted"
        case .modified: "Modified"
        case .renamed: "Renamed"
        }
    }
}
