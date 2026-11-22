import BroskiCore
import SwiftUI

/// One session: agent mark, title, what it asks (needs you), folder (and the Mac, once more than
/// one is paired), time, whether it is pinned or muted, state. A session on a machine that is not reachable, or known only from the cached inbox, stays
/// listed, dimmed, with the machine's status.
struct InboxRowView: View {
    let row: InboxRow
    let brand: AgentBrand
    let machine: MachineSummary?
    var showsMachine = false
    var pinned = false
    var muted = false
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
            AgentMark(brand: brand)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(title).font(.rowTitle).lineLimit(2)
                askText?.lineLimit(1)
                HStack(spacing: 0) {
                    if !place.isEmpty {
                        placeText.lineLimit(1)
                        Text(" · ").font(.footnote).foregroundStyle(.secondary).layoutPriority(1)
                    }
                    timeText.layoutPriority(1)
                    if pinned || muted { marks.padding(.leading, Spacing.xs).layoutPriority(1) }
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
                AgentMark(brand: brand)
                Spacer()
                StateIndicator(state: row.state)
            }
            Text(title).font(.rowTitle)
            askText
            HStack(spacing: Spacing.xs) {
                timeText
                if pinned || muted { marks }
            }
            if !place.isEmpty { placeText }
        }
    }

    private var marks: some View {
        HStack(spacing: Spacing.xxs) {
            if pinned { Image(systemName: "pin.fill") }
            if muted { Image(systemName: "bell.slash") }
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
    }

    private var askText: Text? {
        guard let ask = row.askLine(agent: brand.name) else { return nil }
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

    /// "broski", "MacBook · broski" with several Macs paired, or the machine's status in place of
    /// the folder while it is unreachable.
    private var place: String {
        var parts = showsMachine ? [MachineName.display(row.machineName)] : []
        if !reachable, let machine {
            parts.append(machine.line)
        } else if let folder {
            parts.append(folder)
        }
        return parts.joined(separator: " · ")
    }

    /// "Needs you. Claude Code wants to run npm test. MacBook, broski."
    private var spokenLabel: String {
        let what = row.askLine(agent: brand.name)
        var sentences = [row.state.title, what ?? "\(brand.name), \(title)"]
        let location = [showsMachine ? MachineName.display(row.machineName) : nil, folder].compactMap(\.self)
        if !location.isEmpty { sentences.append(location.joined(separator: ", ")) }
        if !reachable, let machine { sentences.append(machine.line) }
        if pinned { sentences.append("Pinned") }
        if muted { sentences.append("Muted") }
        return sentences.map { $0.hasSuffix(".") || $0.hasSuffix("…") ? $0 : $0 + "." }.joined(separator: " ")
    }
}
