import BroskiCore
import SwiftUI
import UIKit

/// One block of formatted text. Equatable, so a finished block is never drawn again while the open
/// one streams below it.
struct FormatBlockView: View, Equatable {
    let block: FormatBlock
    var role: FormatRole = .page

    nonisolated static func == (lhs: FormatBlockView, rhs: FormatBlockView) -> Bool {
        lhs.block == rhs.block && lhs.role == rhs.role
    }

    var body: some View {
        switch block.content {
        case .paragraph(let spans):
            Text(FormatSpans.attributed(spans))
                .font(role.font)
                .foregroundStyle(role.style)
                .lineSpacing(role.lineSpacing)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .code(let language, let text, let closed):
            FormatCodeBlock(code: text, language: language, isComplete: closed)
        }
    }
}

enum FormatSpans {
    /// Spans as styled text: code by presentation intent, so it follows the block's own font and
    /// Dynamic Type.
    static func attributed(_ spans: [FormatSpan]) -> AttributedString {
        var text = AttributedString()
        for span in spans {
            var piece = AttributedString(span.text)
            if span.code {
                piece.inlinePresentationIntent = .code
                piece.backgroundColor = Color(uiColor: .tertiarySystemFill)
            }
            text += piece
        }
        return text
    }
}

/// A fenced block: its language, a copy button, and the code in one monospaced size that scrolls
/// sideways rather than wrapping. Plain while its fence is still open; coloured once it closes.
struct FormatCodeBlock: View {
    let code: String
    let language: String?
    let isComplete: Bool
    @State private var lines: [CodeLine]?
    @State private var copied = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            ScrollView(.horizontal) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(shown.enumerated()), id: \.offset) { _, line in
                        Text(line.attributed)
                    }
                }
                .font(.codeSmall)
                .fixedSize(horizontal: true, vertical: false)
                .padding(Spacing.m)
                .textSelection(.enabled)
            }
            .scrollIndicators(.hidden)
        }
        .background(Palette.codeBackground, in: .rect(cornerRadius: Radius.small + 4, style: .continuous))
        .task(id: TaskKey(code: code, language: language, isComplete: isComplete)) {
            guard isComplete else { return }
            lines = await Highlighter.shared.highlight(code, language: language)
        }
        .haptic(.confirmed, trigger: copied)
        .accessibilityElement(children: .contain)
    }

    private struct TaskKey: Equatable {
        let code: String
        let language: String?
        let isComplete: Bool
    }

    private var shown: [CodeLine] {
        if isComplete, let lines = lines ?? Highlighter.shared.cached(code, language: language) { return lines }
        return Highlighter.plainLines(code)
    }

    private var header: some View {
        HStack {
            Text(language ?? "Code")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
            Spacer()
            Button {
                UIPasteboard.general.string = code
                copied += 1
            } label: {
                Image(systemName: copied > 0 ? "checkmark" : "doc.on.doc")
                    .contentTransition(.symbolEffect(.replace))
                    .font(.caption.weight(.medium))
                    .frame(minWidth: 32, minHeight: 28)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .accessibilityLabel("Copy code")
        }
        .padding(.leading, Spacing.m)
        .padding(.trailing, Spacing.xs)
        .padding(.top, Spacing.xs)
    }
}
