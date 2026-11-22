import BroskiCore
import SwiftUI

/// One changed path: what changed as a letter git would print, the file name over its folder, and
/// the lines added and removed.
struct GitRowView: View {
    let row: GitRow
    @Environment(\.dynamicTypeSize) private var typeSize

    private var name: String { row.path.lastPathComponent }
    private var folder: String? {
        let folder = (row.path as NSString).deletingLastPathComponent
        return folder.isEmpty ? nil : folder
    }

    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    HStack {
                        ChangeBadge(change: row.change)
                        Spacer()
                        LineCounts(additions: row.additions, deletions: row.deletions)
                    }
                    names(lines: nil)
                }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.m) {
                    ChangeBadge(change: row.change)
                    names(lines: 1)
                    Spacer(minLength: Spacing.s)
                    LineCounts(additions: row.additions, deletions: row.deletions)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spokenLabel)
    }

    /// The file name over where it came from or its folder; at the accessibility sizes they wrap.
    private func names(lines: Int?) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            Text(name)
                .font(.body.weight(.medium))
                .lineLimit(lines)
                .truncationMode(.middle)
            if let detail = row.previousPath.map({ "from \($0)" }) ?? folder {
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(lines)
                    .truncationMode(.head)
            }
        }
    }

    private var spokenLabel: String {
        var parts = [row.change?.spokenName ?? "Untracked", row.path]
        if let additions = row.additions { parts.append("\(additions) added") }
        if let deletions = row.deletions { parts.append("\(deletions) removed") }
        return parts.joined(separator: ", ")
    }
}

private struct ChangeBadge: View {
    let change: GitChange?
    @ScaledMetric(relativeTo: .footnote) private var side: CGFloat = 20

    var body: some View {
        Text(change?.letter ?? "?")
            .font(.system(.caption, design: .monospaced).weight(.bold))
            .foregroundStyle(tint)
            .frame(width: side, height: side)
            .background(tint.opacity(0.14), in: .rect(cornerRadius: Radius.small / 2, style: .continuous))
            .accessibilityHidden(true)
    }

    private var tint: Color {
        switch change {
        case .added, nil: Palette.added
        case .deleted: Palette.removed
        case .conflicted: Palette.caution
        case .modified, .renamed, .copied, .typeChanged: Palette.highlight
        }
    }
}

extension GitChange {
    /// The letter `git status --short` prints.
    var letter: String {
        switch self {
        case .added: "A"
        case .modified: "M"
        case .deleted: "D"
        case .renamed: "R"
        case .copied: "C"
        case .typeChanged: "T"
        case .conflicted: "U"
        }
    }

    var spokenName: String {
        switch self {
        case .added: "Added"
        case .modified: "Modified"
        case .deleted: "Deleted"
        case .renamed: "Renamed"
        case .copied: "Copied"
        case .typeChanged: "Type changed"
        case .conflicted: "Conflicted"
        }
    }
}
