import BroskiCore
import SwiftUI

/// One file's diff from the core's renderer (rendering.md, "Diffs"): a header with its counts, then
/// each hunk, unified with old and new numbers on a compact width and side by side on a regular
/// one; added and removed lines tinted, the words a modification changed tinted harder.
struct DiffView: View {
    let file: DiffFile
    var truncated = false
    @Environment(\.horizontalSizeClass) private var sizeClass

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
                ForEach(file.hunks.indices, id: \.self) { index in
                    let hunk = file.hunks[index]
                    HunkHeader(hunk: hunk)
                    if sizeClass == .regular {
                        ForEach(Array(sideBySide(hunk: hunk).enumerated()), id: \.offset) { _, row in
                            SideBySideLine(row: row)
                        }
                    } else {
                        ForEach(hunk.lines.indices, id: \.self) { line in
                            UnifiedLine(line: hunk.lines[line])
                        }
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
        if file.hunks.isEmpty { return "No lines to show." }
        return nil
    }
}

/// Lines added and removed, signed so the numbers read without their colour.
struct LineCounts: View {
    let additions: Int64?
    let deletions: Int64?

    var body: some View {
        HStack(spacing: Spacing.xs) {
            if let additions, additions > 0 {
                Text("+\(additions)").foregroundStyle(Palette.added)
            }
            if let deletions, deletions > 0 {
                Text("−\(deletions)").foregroundStyle(Palette.removed)
            }
        }
        .font(.codeSmall.weight(.medium))
        .monospacedDigit()
    }
}

private struct DiffFileHeader: View {
    let file: DiffFile

    var body: some View {
        HStack(spacing: Spacing.s) {
            Image(systemName: "doc.text").foregroundStyle(.secondary).accessibilityHidden(true)
            Text(file.path)
                .font(.codeSmall.weight(.medium))
                .lineLimit(1)
                .truncationMode(.head)
            Spacer(minLength: Spacing.s)
            LineCounts(additions: file.additions, deletions: file.deletions)
        }
        .padding(.horizontal, Spacing.m)
        .padding(.vertical, Spacing.s)
        .background(Palette.card)
        .accessibilityElement(children: .combine)
    }
}

private struct HunkHeader: View {
    let hunk: DiffHunk

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

private struct UnifiedLine: View {
    let line: DiffLine

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
            LineNumber(value: line.oldLine)
            LineNumber(value: line.newLine)
            Text(line.sign)
                .foregroundStyle(line.tint ?? .secondary)
                .accessibilityHidden(true)
            DiffLineText(line: line)
        }
        .font(.codeSmall)
        .padding(.horizontal, Spacing.m)
        .padding(.vertical, 1)
        .background(line.tint?.opacity(0.12) ?? .clear)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(line.spoken)
    }
}

private struct SideBySideLine: View {
    let row: SideBySideRow

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            side(row.left, number: row.left?.oldLine)
            Divider()
            side(row.right, number: row.right?.newLine)
        }
        .font(.codeSmall)
    }

    private func side(_ line: DiffLine?, number: Int64?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
            LineNumber(value: number)
            if let line {
                DiffLineText(line: line)
            } else {
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, Spacing.m)
        .padding(.vertical, 1)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(line?.tint?.opacity(0.12) ?? (line == nil ? Color.secondary.opacity(0.05) : .clear))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(line?.spoken ?? "")
    }
}

private struct LineNumber: View {
    let value: Int64?

    var body: some View {
        ZStack(alignment: .trailing) {
            Text("0000").hidden()
            Text(value.map { String($0) } ?? "")
        }
        .foregroundStyle(.tertiary)
        .accessibilityHidden(true)
    }
}

private struct DiffLineText: View {
    let line: DiffLine

    var body: some View {
        Group {
            if line.kind == .noNewline {
                Text("No newline at end of file").foregroundStyle(.secondary)
            } else {
                Text(line.attributed)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }
}

private extension DiffLine {
    var sign: String {
        switch kind {
        case .added: "+"
        case .removed: "−"
        case .context, .noNewline: " "
        }
    }

    var tint: Color? {
        switch kind {
        case .added: Palette.added
        case .removed: Palette.removed
        case .context, .noNewline: nil
        }
    }

    var attributed: AttributedString {
        guard !segments.isEmpty, let tint else { return AttributedString(text.isEmpty ? " " : text) }
        var line = AttributedString()
        for segment in segments {
            var piece = AttributedString(segment.text)
            if segment.emphasized { piece.backgroundColor = tint.opacity(0.32) }
            line += piece
        }
        return line
    }

    var spoken: String {
        switch kind {
        case .added: "Added: \(text)"
        case .removed: "Removed: \(text)"
        case .context: text
        case .noNewline: "No newline at end of file"
        }
    }
}
