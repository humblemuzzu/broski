import BroskiCore
import SwiftUI

/// A file's diff, unified: each hunk's header, then its lines with their old and new numbers, a
/// sign, and a tint for added and removed. The one place a diff is rendered, so the core's diff
/// renderer (and side by side on wide screens) lands here alone.
struct DiffTextView: View {
    let file: GitDiffFile
    let truncated: Bool

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                DiffFileHeader(file: file)
                if let note {
                    Text(note)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(Spacing.l)
                }
                ForEach(file.hunks.indices, id: \.self) { hunk in
                    HunkHeader(hunk: file.hunks[hunk])
                    ForEach(file.hunks[hunk].lines.indices, id: \.self) { line in
                        DiffLineRow(line: file.hunks[hunk].lines[line])
                    }
                }
                if truncated {
                    Text("The diff goes on past what Broski shows.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(Spacing.l)
                }
            }
        }
        .background(Color(uiColor: .systemBackground))
    }

    private var note: String? {
        if file.binary { return "Binary file changed." }
        if file.change == .conflicted { return "This file has conflicts. Resolve them on your Mac." }
        if let previous = file.previousPath { return "Renamed from \(previous)" }
        return nil
    }
}

/// The file the diff is of, with its lines removed and added, as the head of a card.
private struct DiffFileHeader: View {
    let file: GitDiffFile

    private var counts: (removed: Int64, added: Int64) {
        file.hunks.reduce(into: (Int64(0), Int64(0))) { counts, hunk in
            for line in hunk.lines {
                if line.kind == .removed { counts.0 += 1 } else if line.kind == .added { counts.1 += 1 }
            }
        }
    }

    var body: some View {
        HStack(spacing: Spacing.s) {
            Image(systemName: "doc.text").foregroundStyle(.secondary).accessibilityHidden(true)
            Text(file.path)
                .font(.codeSmall.weight(.medium))
                .lineLimit(1)
                .truncationMode(.head)
            Spacer(minLength: Spacing.s)
            LineCounts(additions: counts.added, deletions: counts.removed)
        }
        .padding(.horizontal, Spacing.m)
        .padding(.vertical, Spacing.s)
        .background(Palette.card)
        .accessibilityElement(children: .combine)
    }
}

private struct HunkHeader: View {
    let hunk: GitDiffHunk

    var body: some View {
        Text("@@ −\(hunk.oldStart),\(hunk.oldLines) +\(hunk.newStart),\(hunk.newLines) @@ \(hunk.header ?? "")")
            .font(.codeSmall)
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.m)
            .padding(.vertical, Spacing.xs)
            .background(Palette.working.opacity(0.08))
            .accessibilityLabel("Lines \(hunk.newStart) to \(hunk.newStart + max(hunk.newLines - 1, 0))")
    }
}

private struct DiffLineRow: View {
    let line: GitDiffLine

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
            number(line.oldLine)
            number(line.newLine)
            Text(sign)
                .foregroundStyle(tint ?? .secondary)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text(line.text.isEmpty ? " " : line.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                if line.noNewline == true {
                    Text("No newline at end of file").foregroundStyle(.secondary)
                }
            }
        }
        .font(.codeSmall)
        .padding(.horizontal, Spacing.m)
        .padding(.vertical, 1)
        .background(tint?.opacity(0.12) ?? .clear)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(spoken)
    }

    private func number(_ value: Int64?) -> some View {
        ZStack(alignment: .trailing) {
            Text("0000").hidden()
            Text(value.map { String($0) } ?? "")
        }
        .foregroundStyle(.tertiary)
        .accessibilityHidden(true)
    }

    private var sign: String {
        switch line.kind {
        case .added: "+"
        case .removed: "−"
        case .context: " "
        }
    }

    private var tint: Color? {
        switch line.kind {
        case .added: Palette.added
        case .removed: Palette.removed
        case .context: nil
        }
    }

    private var spoken: String {
        switch line.kind {
        case .added: "Added: \(line.text)"
        case .removed: "Removed: \(line.text)"
        case .context: line.text
        }
    }
}
