import BroskiCore
import SwiftUI

/// Text that is not markdown (a command's output, an error, a log), as the core lays it out
/// (`formatLog`, `toolBody`): monospaced lines whose web links, addresses and paths open.
struct LogLinesView: View {
    let log: LogText
    var tint: Color = .secondary
    var font: Font = .codeSmall
    @Environment(\.reading) private var reading

    var body: some View {
        let style = SpanStyle(font: font, codeFont: .codeSmall, underlinesLinks: reading.underlinesLinks)
        var text = AttributedString()
        for (index, line) in log.lines.enumerated() {
            if index > 0 { text += AttributedString("\n") }
            text += line.spans.isEmpty ? AttributedString(" ") : FormatSpans.attributed(line.spans, style: style)
        }
        return Text(text)
            .font(font)
            .foregroundStyle(tint)
            .tint(FormatTokens.link)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .formatLinkHandling()
    }
}

/// A log in a capped box that opens at its newest lines, with the whole of it a tap away.
struct LogBox: View {
    let log: LogText
    let title: String
    /// The whole text, when the box shows only its last lines.
    let source: String?
    /// What the link to the whole text says.
    var showAll: LocalizedStringKey = "Show all output"
    @Environment(\.formatContext) private var context

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            ScrollView {
                LogLinesView(log: log).padding(Spacing.s)
            }
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .frame(maxHeight: ToolDetailView.outputCap)
            .fixedSize(horizontal: false, vertical: true)
            .background(Palette.codeBackground, in: .rect(cornerRadius: Radius.small, style: .continuous))
            if log.hiddenLines > 0, let source {
                NavigationLink(value: Route.text(TextPage(title: title, text: source, format: .log, context: context))) {
                    HStack(spacing: Spacing.xs) {
                        Text(showAll)
                        Text("· ^[\(log.hiddenLines) more line](inflect: true)").foregroundStyle(.secondary)
                    }
                    .font(.footnote.weight(.medium))
                }
            }
        }
    }
}

/// A command as the agent wrote it, coloured as shell, after a dimmed `$`.
struct CommandLineView: View {
    let command: String
    @State private var lines: [CodeLine]?

    var body: some View {
        Text(attributed)
            .font(.codeSmall)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .task(id: command) { lines = await Highlighter.shared.highlight(command, language: "bash") }
    }

    private var attributed: AttributedString {
        var text = AttributedString("$ ")
        text.foregroundColor = Color(uiColor: .tertiaryLabel)
        let shown = lines ?? Highlighter.plainLines(command)
        for (index, line) in shown.enumerated() {
            if index > 0 { text += AttributedString("\n  ") }
            text += line.attributed
        }
        return text
    }
}
