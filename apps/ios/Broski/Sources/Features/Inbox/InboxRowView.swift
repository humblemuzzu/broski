import BroskiCore
import SwiftUI

/// One session: agent mark, title, what it asks (needs you), machine and folder, time, state.
/// A session on a machine that is not reachable, or known only from the cached inbox, stays
/// listed, dimmed, with the machine's status.
struct InboxRowView: View {
    let row: InboxRow
    let machine: MachineSummary?
    @Environment(\.dynamicTypeSize) private var typeSize

    private var title: String { row.title ?? "Untitled session" }
    private var folder: String? { row.cwd.map { URL(fileURLWithPath: $0).lastPathComponent } }
    private var updated: Date { Date(unixMilliseconds: row.updatedAt) }
    private var reachable: Bool { (machine?.isReady ?? false) && !row.cached }

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

    /// The title on up to two lines, then the ask, then the place with the time at its end, which
    /// the place's own length never cuts off.
    private var compact: some View {
        HStack(alignment: .top, spacing: Spacing.m) {
            AgentMark(backend: row.session.backend)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(title).font(.rowTitle).lineLimit(2)
                askText?.lineLimit(1)
                HStack(spacing: 0) {
                    placeText.lineLimit(1)
                    Text(" · ").font(.footnote).foregroundStyle(.secondary).layoutPriority(1)
                    timeText.layoutPriority(1)
                }
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
        guard let ask = row.askLine else { return nil }
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
        let what = row.askLine
        var sentences = [row.state.title, what ?? "\(row.session.backend.displayName), \(title)"]
        sentences.append([row.machineName, folder].compactMap(\.self).joined(separator: ", "))
        if !reachable, let machine { sentences.append(machine.line) }
        return sentences.map { $0.hasSuffix(".") || $0.hasSuffix("…") ? $0 : $0 + "." }.joined(separator: " ")
    }
}
