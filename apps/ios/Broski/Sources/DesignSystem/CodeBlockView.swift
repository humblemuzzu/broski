import BroskiCore
import SwiftUI
import UIKit

/// A fenced code block in the transcript: its language, a copy button, and the code in one
/// monospaced size that scrolls sideways rather than wrapping. A block still streaming shows plain
/// text; it is coloured once it is complete.
struct CodeBlockView: View {
    let code: String
    let language: String?
    var isComplete = true
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

/// A file's text as numbered lines that wrap, coloured by the language its name says, drawn only
/// as they scroll into view.
struct CodeFileView: View {
    let text: String
    let language: String?
    @State private var lines: [CodeLine]

    init(text: String, language: String?) {
        self.text = text
        self.language = language
        var plain = Highlighter.plainLines(text)
        if plain.count > 1, plain.last?.spans.isEmpty == true { plain.removeLast() }
        _lines = State(initialValue: Highlighter.shared.cached(text, language: language) ?? plain)
    }

    private var widestNumber: String { String(lines.count) }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(lines.indices, id: \.self) { index in
                    NumberedLine(number: index + 1, line: lines[index], widestNumber: widestNumber)
                }
            }
            .padding(.vertical, Spacing.s)
        }
        .background(Color(uiColor: .systemBackground))
        .task(id: text) {
            guard language != nil else { return }
            let coloured = await Highlighter.shared.highlight(text, language: language)
            if coloured.count >= lines.count { lines = Array(coloured.prefix(lines.count)) }
        }
    }
}

private struct NumberedLine: View {
    let number: Int
    let line: CodeLine
    let widestNumber: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.m) {
            ZStack(alignment: .trailing) {
                Text(widestNumber).hidden()
                Text(number, format: .number.grouping(.never))
            }
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
            Text(line.attributed)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
        .font(.codeSmall)
        .padding(.horizontal, Spacing.m)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Line \(number): \(line.spans.map(\.text).joined())")
    }
}
