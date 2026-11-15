import SwiftUI

/// A text file as numbered monospaced lines that wrap, drawn only as they scroll into view. The
/// one place file text is rendered, so syntax colouring from the core lands here alone.
struct FileTextView: View {
    let file: TextFile

    private var widestNumber: String { String(file.lines.count) }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(file.lines.indices, id: \.self) { index in
                    LineRow(number: index + 1, text: file.lines[index], widestNumber: widestNumber)
                }
            }
            .padding(.vertical, Spacing.s)
        }
        .background(Color(uiColor: .systemBackground))
    }
}

private struct LineRow: View {
    let number: Int
    let text: Substring
    let widestNumber: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.m) {
            ZStack(alignment: .trailing) {
                Text(widestNumber).hidden()
                Text(number, format: .number.grouping(.never))
            }
            .font(.codeSmall)
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
            Text(text.isEmpty ? " " : String(text))
                .font(.codeSmall)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
        .padding(.horizontal, Spacing.m)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Line \(number): \(String(text))")
    }
}
