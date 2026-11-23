import BroskiCore
import SwiftUI

/// One session, every one alike: the agent's mark, the title on one line, whether it is pinned or
/// muted, how long ago, and its state in a column of its own (a dot for needs you and done, the orb
/// while working), so the ages line up down the list. One that needs the person says what it asks on
/// a short second line. A session on a machine that is not reachable, or known only from the cached
/// inbox, stays listed, dimmed, with the machine's status in place of the ask.
struct InboxRowView: View {
    let row: InboxRow
    let brand: AgentBrand
    let machine: MachineSummary?
    var showsMachine = false
    var pinned = false
    var muted = false
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var markSide: CGFloat = 22

    private var title: String { row.title ?? "Untitled session" }
    private var folder: String? { row.cwd.map { URL(fileURLWithPath: $0).lastPathComponent } }
    private var updated: Date { Date(unixMilliseconds: row.updatedAt) }
    private var reachable: Bool { (machine?.isReady ?? false) && !row.cached }

    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                stacked
            } else {
                line
            }
        }
        .dimmed(!reachable)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spokenLabel)
    }

    private var line: some View {
        HStack(spacing: Spacing.m) {
            AgentLogo(brand: brand, side: min(markSide, 30))
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(title).lineLimit(1)
                if let detail {
                    detail.font(.footnote).lineLimit(1)
                }
            }
            Spacer(minLength: Spacing.s)
            if pinned || muted { marks }
            ShortAge(date: updated)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            StateIndicator(state: row.state)
        }
        .frame(minHeight: 30)
    }

    /// What the agent asks, or why its Mac cannot be reached.
    private var detail: Text? {
        if let askText { return askText }
        guard !reachable, let machine else { return nil }
        return Text(machine.line).foregroundStyle(.secondary)
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
            askText?.font(.subheadline)
            HStack(spacing: Spacing.xs) {
                timeText
                if pinned || muted { marks }
            }
            if !place.isEmpty { placeText }
        }
        .padding(.vertical, Spacing.xxs)
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
        return Text(ask).foregroundStyle(Palette.needsYou)
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
