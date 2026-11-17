import BroskiCore
import SwiftUI

/// A call's arguments as the core lays them out (`toolArguments`): a property list where short
/// values sit beside their key, long ones and code under it, the agent's own prose formatted and
/// folded, and objects open one level further in.
struct ToolArgumentsView: View {
    let rows: [ToolArgument]
    @ScaledMetric(relativeTo: .footnote) private var indent: CGFloat = 14

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs + Spacing.xxs) {
            ForEach(rows.indices, id: \.self) { index in
                ArgumentRow(row: rows[index])
                    .padding(.leading, CGFloat(min(rows[index].depth, 4)) * indent)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ArgumentRow: View {
    let row: ToolArgument

    var body: some View {
        switch row.value {
        case .inline(let text, let kind):
            HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                key
                Text(text)
                    .font(.codeSmall)
                    .foregroundStyle(kind.color ?? .primary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        case .text(let text, let hiddenLines):
            under {
                FormattedMessage(text: text, role: .quiet)
                if hiddenLines > 0 { hidden(Int(hiddenLines)) }
            }
        case .code(let text, let language, let hiddenLines):
            under {
                ArgumentCode(text: text, language: language)
                if hiddenLines > 0 { hidden(Int(hiddenLines)) }
            }
        case .markdown(let text):
            under { FoldedProse(text: text) }
        case .nested(let count, let list):
            HStack(spacing: Spacing.s) {
                key
                Text(list ? "^[\(count) item](inflect: true)" : "^[\(count) field](inflect: true)")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        case .more(let count):
            Text("^[\(count) more argument](inflect: true)").font(.caption).foregroundStyle(.secondary)
        }
    }

    private var key: some View {
        Text(row.key)
            .font(.system(.caption, design: .monospaced).weight(.medium))
            .foregroundStyle(.secondary)
            .fixedSize()
    }

    private func under<Value: View>(@ViewBuilder _ value: () -> Value) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            key
            value()
        }
    }

    private func hidden(_ lines: Int) -> some View {
        Text("^[\(lines) more line](inflect: true)").font(.caption).foregroundStyle(.secondary)
    }
}

/// A code value in its language's colours, in a box that scrolls past a few lines.
private struct ArgumentCode: View {
    let text: String
    let language: String?
    @State private var lines: [CodeLine]?

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            Text((lines ?? Highlighter.plainLines(text)).reduce(into: AttributedString()) { result, line in
                if !result.characters.isEmpty { result += AttributedString("\n") }
                result += line.attributed
            })
            .font(.codeSmall)
            .fixedSize()
            .textSelection(.enabled)
            .padding(Spacing.s)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: 180)
        .fixedSize(horizontal: false, vertical: true)
        .background(Palette.codeBackground, in: .rect(cornerRadius: Radius.small, style: .continuous))
        .task(id: text) {
            guard language != nil else { return }
            lines = await Highlighter.shared.highlight(text, language: language)
        }
    }
}

/// The agent's prose (a subagent's prompt, a plan) formatted, folded to about six lines.
private struct FoldedProse: View {
    let text: String
    @State private var open = false
    @ScaledMetric(relativeTo: .subheadline) private var folded: CGFloat = 6 * 20

    private var long: Bool { FormattedText.exceeds(text, limit: 2) || text.count > 360 }

    var body: some View {
        let folds = long && !open
        VStack(alignment: .leading, spacing: Spacing.xs) {
            FormattedText(text: text, role: .quiet, menu: false)
                .frame(maxHeight: folds ? folded : nil, alignment: .top)
                .clipped()
                .mask(alignment: .top) {
                    LinearGradient(stops: [.init(color: .black, location: folds ? 0.7 : 1), .init(color: .black.opacity(folds ? 0 : 1), location: 1)], startPoint: .top, endPoint: .bottom)
                }
            if folds {
                Button("Show more") { withAnimation(.easeOut(duration: 0.2)) { open = true } }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(FormatTokens.link)
            }
        }
    }
}
