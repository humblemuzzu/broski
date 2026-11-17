import BroskiCore
import SwiftUI

/// Something that happened that is not a turn (a background task's end, a subagent's report, a
/// command's output, an extension's message), as one quiet line like a work row: its kind, what
/// happened, how long it took. It opens in place to what it carries, each part capped, and the
/// whole of a long body opens on a screen of its own.
struct ActivityRowView: View {
    let entry: ActivityEntry
    @Environment(Disclosure.self) private var disclosure
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .footnote) private var iconWidth: CGFloat = 18

    private var activity: Activity { entry.item.activity }
    private var look: ActivityLook { entry.look }
    private var isOpen: Bool { disclosure.isOpen(entry.id) }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Button {
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { disclosure.toggle(entry.id) }
            } label: {
                header.frame(minHeight: 28).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(!look.opens)
            .accessibilityElement(children: .combine)
            .accessibilityValue(look.opens ? (isOpen ? "Expanded" : "Collapsed") : "")
            .accessibilityHint(look.opens ? "Shows what it reported" : "")
            if isOpen {
                ActivityDetail(activity: activity, look: look)
                    .padding(.leading, iconWidth + Spacing.s)
                    .padding(.bottom, Spacing.s)
                    .transition(.opacity)
            }
        }
        .haptic(.toggled(expanded: true), trigger: isOpen) { !$0 && $1 }
        .haptic(.toggled(expanded: false), trigger: isOpen) { $0 && !$1 }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
            Image(systemName: activity.kind.symbol)
                .font(.footnote)
                .frame(width: iconWidth)
                .foregroundStyle(look.tone.tint)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(activity.title)
                    .font(.subheadline)
                    .foregroundStyle(.primary)
                    .lineLimit(isOpen ? nil : 2)
                if !isOpen, let preview = look.preview {
                    Text(preview)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: Spacing.s)
            if !look.facts.isEmpty {
                Text(look.facts.joined(separator: " · "))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(look.tone == .failed ? Palette.failed : .secondary)
                    .fixedSize()
            }
            if look.opens {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .rotationEffect(.degrees(isOpen ? 90 : 0))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        }
    }
}

/// What an opened activity shows: the command, the body (a log's last lines, a message's first
/// blocks, a text's first lines) and the subagent's session.
private struct ActivityDetail: View {
    let activity: Activity
    let look: ActivityLook
    @Environment(\.chatMachineId) private var machineId

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            if let command = activity.command, !command.isEmpty {
                CommandLineView(command: command)
            }
            if let content = activity.body {
                ActivityBodyView(title: activity.title, content: content, log: look.log)
            }
            if let child = activity.childSession, let machineId {
                NavigationLink(value: Route.session(machineId: machineId, session: child)) {
                    Label("Open the subagent's session", systemImage: "arrow.up.forward.square")
                        .font(.footnote.weight(.medium))
                }
            }
        }
    }
}

private struct ActivityBodyView: View {
    let title: String
    let content: ActivityBody
    let log: TextClip?
    @Environment(\.formatContext) private var context

    /// Blocks of a message an opened row draws; the rest is on the full page.
    private static let shownBlocks = 8
    private static let textLines: UInt32 = 20

    var body: some View {
        switch content.format {
        case .log:
            if let log {
                let lines = formatLog(text: log.text, maxLines: UInt32.max, keep: .tail).lines
                LogBox(log: LogText(lines: lines, hiddenLines: log.hiddenLines), title: title, source: content.text, showAll: "Show the whole log")
            }
        case .markdown:
            VStack(alignment: .leading, spacing: Spacing.s) {
                FormattedText(text: content.text, role: .quiet, limit: Self.shownBlocks)
                if FormattedText.exceeds(content.text, limit: Self.shownBlocks) { showAll("Read all of it", hidden: nil) }
            }
        case .text:
            let clip = clipText(text: content.text, maxLines: Self.textLines, keep: .head)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                FormattedMessage(text: clip.text, role: .quiet)
                if clip.hiddenLines > 0 { showAll("Show all of it", hidden: clip.hiddenLines) }
            }
        }
    }

    private func showAll(_ words: String, hidden: UInt32?) -> some View {
        let page = TextPage(title: title, text: content.text, format: TextPage.Format(content.format), context: context)
        return NavigationLink(value: Route.text(page)) {
            HStack(spacing: Spacing.xs) {
                Text(words)
                if let hidden { Text("· ^[\(hidden) more line](inflect: true)").foregroundStyle(.secondary) }
            }
            .font(.footnote.weight(.medium))
        }
    }
}

extension ActivityKind {
    var symbol: String {
        switch self {
        case .task: "terminal"
        case .agent: "person.2"
        case .command: "command"
        case .message: "puzzlepiece.extension"
        }
    }
}

extension ActivityTone {
    var tint: Color {
        switch self {
        case .plain: .secondary
        case .working: Palette.working
        case .failed: Palette.failed
        }
    }
}
