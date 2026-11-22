import BroskiCore
import SwiftUI

/// A file's text as numbered lines that wrap, coloured by the language its name says, drawn only
/// as they scroll into view; opened at `line`, which is marked, when one is given.
struct CodeFileView: View {
    let text: String
    let language: String?
    var line: Int?
    @State private var rendered: [AttributedString]
    @State private var rawLines: [String]

    init(text: String, language: String?, line: Int? = nil) {
        self.text = text
        self.language = language
        self.line = line
        var plain = Highlighter.plainLines(text)
        if plain.count > 1, plain.last?.spans.isEmpty == true { plain.removeLast() }
        let initial = Highlighter.shared.cached(text, language: language) ?? plain
        _rendered = State(initialValue: initial.map(\.attributed))
        _rawLines = State(initialValue: initial.map { $0.spans.map(\.text).joined() })
    }

    private var widestNumber: String { String(rendered.count) }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(rendered.indices, id: \.self) { index in
                    NumberedLine(
                        number: index + 1,
                        text: rendered[index],
                        plainText: rawLines[index],
                        widestNumber: widestNumber)
                        .background(index + 1 == line ? Palette.highlight.opacity(0.14) : .clear)
                        .id(index + 1)
                }
            }
            .scrollTargetLayout()
            .padding(.vertical, Spacing.s)
        }
        .scrollPosition(id: .constant(line), anchor: .center)
        .background(Color(uiColor: .systemBackground))
        .task(id: text) {
            guard language != nil else { return }
            let coloured = await Highlighter.shared.highlight(text, language: language)
            if coloured.count >= rendered.count {
                let slice = coloured.prefix(rendered.count)
                rendered = slice.map(\.attributed)
                rawLines = slice.map { $0.spans.map(\.text).joined() }
            }
        }
    }
}

private struct NumberedLine: View {
    let number: Int
    let text: AttributedString
    let plainText: String
    let widestNumber: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.m) {
            ZStack(alignment: .trailing) {
                Text(widestNumber).hidden()
                Text(number, format: .number.grouping(.never))
            }
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
            Text(text)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
        .font(.codeSmall)
        .padding(.horizontal, Spacing.m)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Line \(number): \(plainText)")
    }
}
