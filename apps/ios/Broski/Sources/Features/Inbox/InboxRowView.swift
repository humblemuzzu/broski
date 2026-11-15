import BroskiCore
import SwiftUI

/// One session: agent mark, title, what it asks (needs you), machine and folder, time, state.
/// A session on a machine that is not reachable stays listed, dimmed, with the machine's status.
struct InboxRowView: View {
    let row: InboxRow
    let machine: MachineSummary?
    @Environment(\.dynamicTypeSize) private var typeSize

    private var title: String { row.title ?? "Untitled session" }
    private var folder: String? { row.cwd.map { URL(fileURLWithPath: $0).lastPathComponent } }
    private var updated: Date { Date(unixMilliseconds: row.updatedAt) }
    private var reachable: Bool { machine?.isReady ?? false }

    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                stacked
            } else {
                compact
            }
        }
        .padding(.vertical, Spacing.xxs)
        .dimmed(!reachable)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spokenLabel)
    }

    /// One line each for title, ask and place, the time beside the title.
    private var compact: some View {
        HStack(alignment: .top, spacing: Spacing.m) {
            AgentMark(backend: row.session.backend)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                    Text(title).font(.rowTitle).lineLimit(1)
                    Spacer(minLength: Spacing.s)
                    timeText
                }
                askText?.lineLimit(1)
                placeText.lineLimit(1)
            }
            StateIndicator(state: row.state)
                .frame(minHeight: 22)
        }
    }

    /// At the accessibility sizes the mark and state sit above the text, which takes the whole
    /// width and wraps rather than truncates.
    private var stacked: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack {
                AgentMark(backend: row.session.backend)
                Spacer()
                StateIndicator(state: row.state)
            }
            Text(title).font(.rowTitle)
            askText
            timeText
            placeText
        }
    }

    private var askText: Text? {
        guard row.state == .needsYou, let ask = row.ask else { return nil }
        return Text(ask).font(.subheadline).foregroundStyle(Palette.needsYou)
    }

    private var placeText: some View {
        Text(place).font(.footnote).foregroundStyle(.secondary)
    }

    private var timeText: some View {
        RelativeTime(date: updated)
            .font(.footnote)
            .foregroundStyle(.secondary)
    }

    /// "MacBook · broski", or the machine's status in place of the folder while it is unreachable.
    private var place: String {
        var parts = [row.machineName]
        if !reachable, let machine {
            parts.append(machine.line)
        } else if let folder {
            parts.append(folder)
        }
        return parts.joined(separator: " · ")
    }

    /// "Needs you. Claude Code wants to run npm test. MacBook, broski."
    private var spokenLabel: String {
        let what = row.state == .needsYou ? row.ask : nil
        var sentences = [row.state.title, what ?? "\(row.session.backend.displayName), \(title)"]
        sentences.append([row.machineName, folder].compactMap(\.self).joined(separator: ", "))
        if !reachable, let machine { sentences.append(machine.line) }
        return sentences.map { $0.hasSuffix(".") || $0.hasSuffix("…") ? $0 : $0 + "." }.joined(separator: " ")
    }
}
