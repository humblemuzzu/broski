import BroskiCore
import SwiftUI

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
