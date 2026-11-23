import BroskiCore
import SwiftUI

/// Home: every session on every paired Mac, needs you → pinned → working → done → idle, under the
/// status of any machine that is not fine. Idle sessions fold under their header whenever anything
/// else is listed, so what needs a look comes first. One filter button narrows the list by agent,
/// project or Mac, said under the title while on; a search button beside it opens a search of the
/// titles and folders. A row opens its chat;
/// the tab bar's New Session button opens an empty one here.
struct InboxScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var path: [Route] = []
    @State private var query = ""
    /// Whether idle sessions show: the person's choice, or set open when Idle was all there was, so
    /// they never fold away on their own from under the person's eyes. Nil, they start folded.
    @State private var idleOpen: Bool?
    @State private var searching = false

    var body: some View {
        NavigationStack(path: $path) {
            list
                .navigationTitle("Inbox")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar(removing: .title)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        InboxTitle(filter: model.inbox.filter.summary(machines: model.machines))
                    }
                    .sharedBackgroundVisibility(.hidden)
                    ToolbarItem(placement: .topBarTrailing) { InboxFilterMenu() }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Search", systemImage: "magnifyingglass", action: openSearch)
                            .accessibilityIdentifier("inbox.search")
                    }
                }
                .toolbarVisibility(searching ? .hidden : .automatic, for: .navigationBar)
                .safeAreaBar(edge: .top) {
                    if searching {
                        InboxSearchField(query: $query, close: closeSearch)
                            .padding(.horizontal, Spacing.l)
                            .padding(.bottom, Spacing.s)
                            .transition(.opacity)
                    }
                }
                .routeDestinations()
        }
        .environment(\.openSession, OpenSessionAction { open($0) })
        .environment(\.openRoute, OpenRouteAction { path.append($0) })
        .onChange(of: model.sessionToOpen, initial: true) { _, target in
            guard let target else { return }
            path = [.session(machineId: target.machineId, session: target.session)]
            model.sessionToOpen = nil
        }
        .onChange(of: path.isEmpty, initial: true) { _, atRoot in
            model.inboxAtRoot = atRoot
        }
        .onChange(of: model.startsNewSession, initial: true) { _, starts in
            guard starts else { return }
            model.startsNewSession = false
            if path.last != .newSession { path = [.newSession] }
        }
        .onChange(of: query) { _, query in model.inbox.search(query) }
        .onChange(of: model.sessionPreferences.pinned, initial: true) { _, pinned in model.inbox.keep(pinned) }
    }

    private func openSearch() {
        withAnimation(Motion.snappy(reduceMotion: reduceMotion)) { searching = true }
    }

    private func closeSearch() {
        withAnimation(Motion.snappy(reduceMotion: reduceMotion)) {
            query = ""
            searching = false
        }
    }

    private func open(_ target: SessionTarget) {
        path.append(.session(machineId: target.machineId, session: target.session))
    }

    private var sections: [InboxSection] {
        model.inbox.sections(pinned: model.sessionPreferences.pinned, query: query)
    }

    /// Idle shows when it was opened, by the person or by being all there was, and while searching.
    private func showsIdle(in sections: [InboxSection]) -> Bool {
        idleOpen ?? !query.isEmpty
    }

    private func onlyIdle(_ sections: [InboxSection]) -> Bool {
        !sections.isEmpty && sections.allSatisfy { $0.kind == .state(.idle) }
    }

    /// Older sessions load as the end of the list comes into view; folded idle sessions would hide them.
    private func loadsMore(_ sections: [InboxSection], idleShown: Bool) -> Bool {
        model.inbox.hasMore && (idleShown || !sections.contains { $0.kind == .state(.idle) })
    }

    private var list: some View {
        let sections = sections
        let idleShown = showsIdle(in: sections)
        let rowKeys = sections.flatMap { section in
            section.kind == .state(.idle) && !idleShown ? [] : section.rows.map(\.key)
        }
        return List {
            if !chips.isEmpty {
                MachineChips(chips: chips)
            }
            if let answer = model.inbox.lastAnswer, let notice = answer.notice {
                Banner(style: .warning, message: notice) {
                    Button("OK") { model.inbox.dismissAnswerNotice() }
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
            ForEach(sections) { section in
                let isIdle = section.kind == .state(.idle)
                Section {
                    if !isIdle || idleShown {
                        ForEach(section.rows, id: \.key) { row in
                            NavigationLink(value: Route.session(machineId: row.machineId, session: row.session)) {
                                InboxRowView(
                                    row: row, brand: model.brand(of: row.session, on: row.machineId),
                                    machine: model.machine(id: row.machineId)?.summary,
                                    showsMachine: model.machines.count > 1,
                                    pinned: model.sessionPreferences.pinned.contains(row.target),
                                    muted: model.sessionPreferences.muted.contains(row.target))
                            }
                            .navigationLinkIndicatorVisibility(.hidden)
                            .inboxRowActions(row, inbox: model.inbox, preferences: model.sessionPreferences)
                        }
                    }
                } header: {
                    if isIdle {
                        IdleHeader(count: section.rows.count, isOpen: idleShown) {
                            withAnimation(Motion.snappy(reduceMotion: reduceMotion)) { idleOpen = !idleShown }
                        }
                    } else {
                        InboxSectionHeader(
                            kind: section.kind, count: section.rows.count,
                            markAllSeen: section.kind == .state(.done) ? { model.inbox.markAllSeen() } : nil)
                    }
                }
            }
            if loadsMore(sections, idleShown: idleShown) {
                LoadingMoreRow()
                    .task(id: model.inbox.rows.count) {
                        while !Task.isCancelled && model.inbox.hasMore {
                            await model.inbox.loadMore()
                        }
                    }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if sections.isEmpty {
                if !query.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    InboxEmptyState(
                        filter: model.inbox.filter, machines: model.machines,
                        clear: { model.inbox.filter = InboxFilter() },
                        showAllStates: { model.inbox.filter.state = nil },
                        startSession: { path.append(.newSession) })
                }
            }
        }
        .onChange(of: onlyIdle(sections), initial: true) { _, only in
            if only && idleOpen == nil { idleOpen = true }
        }
        .refreshable { await model.inbox.refresh() }
        // Rows move, appear and leave with an animation, but a row's own text changing does not
        // animate the list, and nothing animates under a pushed chat.
        .animation(path.isEmpty ? Motion.snappy(reduceMotion: reduceMotion) : nil, value: rowKeys)
        .animation(path.isEmpty ? Motion.snappy(reduceMotion: reduceMotion) : nil, value: chips)
        .animation(Motion.snappy(reduceMotion: reduceMotion), value: model.inbox.filter)
        .haptic(.failed, trigger: lostMachines, when: { $1 > $0 })
        .sensoryFeedback(trigger: model.inbox.lastAnswer) { _, answer in answer?.haptic.feedback }
    }

    private var chips: [MachineChips.Chip] {
        model.machines.compactMap { machine in
            let summary = machine.summary
            return summary.chip.map { MachineChips.Chip(id: machine.id, text: $0, tone: summary.health.tone) }
        }
    }

    /// Machines whose link was lost or refused; a rise plays the failure haptic.
    private var lostMachines: Int {
        model.machines.count { [.attention, .revoked].contains($0.summary.health) }
    }
}

/// The plain white the inbox says its own words in: the filter under the title, the section headers
/// and their counts, Mark All Read. Readable at a glance, a step below the rows' titles.
private let inboxTone = Color.primary.opacity(0.8)

/// What the filter narrows the inbox to, in the bar level with its buttons; nothing while no filter is
/// on. The screen draws no name of its own.
private struct InboxTitle: View {
    let filter: String?

    var body: some View {
        Group {
            if let filter {
                Text(filter)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(inboxTone)
                    .lineLimit(1)
                    .fixedSize()
                    .transition(.opacity)
                    .accessibilityLabel("Showing \(filter)")
            }
        }
        .animation(.snappy(duration: 0.2), value: filter)
    }
}

/// A section's name and how many it holds.
private struct InboxSectionHeader: View {
    let kind: InboxSection.Kind
    let count: Int
    var markAllSeen: (() -> Void)?

    private var title: String {
        switch kind {
        case .state(let state): state.title
        case .pinned: "Pinned"
        }
    }

    var body: some View {
        HStack(spacing: Spacing.s) {
            SectionLabel(title: title, count: count)
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)
            if let markAllSeen {
                Spacer()
                Button("Mark All Read", action: markAllSeen)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(inboxTone)
                    .textCase(nil)
            }
        }
    }
}

/// Idle's header, which folds the idle sessions away and opens them again.
private struct IdleHeader: View {
    let count: Int
    let isOpen: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: Spacing.s) {
                SectionLabel(title: InboxState.idle.title, count: count)
                Spacer(minLength: Spacing.s)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(inboxTone)
                    .rotationEffect(.degrees(isOpen ? 90 : 0))
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: isOpen)
        .accessibilityLabel("Idle, \(count) sessions")
        .accessibilityValue(isOpen ? "Shown" : "Folded")
        .accessibilityHint(isOpen ? "Folds the idle sessions" : "Shows the idle sessions")
        .accessibilityIdentifier("inbox.idle")
    }
}

private struct SectionLabel: View {
    let title: String
    let count: Int

    var body: some View {
        HStack(spacing: Spacing.s) {
            Text(title)
            Text(count, format: .number)
        }
        .font(.subheadline.weight(.medium))
        .foregroundStyle(inboxTone)
        .textCase(nil)
    }
}

/// The end of the rows while older sessions load into them.
private struct LoadingMoreRow: View {
    var body: some View {
        ProgressView()
            .frame(maxWidth: .infinity)
            .listRowBackground(Color.clear)
            .accessibilityLabel("Loading older sessions")
            .accessibilityIdentifier("inbox.more")
    }
}

/// The status of each machine that is not fine, above the sessions.
struct MachineChips: View {
    struct Chip: Identifiable, Equatable {
        let id: String
        let text: String
        let tone: StatusChip.Tone
    }

    let chips: [Chip]

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: Spacing.s) {
                ForEach(chips) { chip in
                    StatusChip(text: chip.text, tone: chip.tone)
                }
            }
        }
        .scrollIndicators(.hidden)
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
    }
}
