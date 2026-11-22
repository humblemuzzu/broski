import BroskiCore
import SwiftUI

/// Home: every session on every paired Mac, needs you → pinned → working → done → idle, under the
/// status of any machine that is not fine. A row opens its chat; New Session opens an empty one.
struct InboxScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var path: [Route] = []

    var body: some View {
        NavigationStack(path: $path) {
            list
                .navigationTitle(model.inbox.filter.map(\.title) ?? "Inbox")
                .toolbar { toolbar }
                .routeDestinations()
        }
        .environment(\.openSession, OpenSessionAction { open($0) })
        .onChange(of: model.sessionToOpen, initial: true) { _, target in
            guard let target else { return }
            path = [.session(machineId: target.machineId, session: target.session)]
            model.sessionToOpen = nil
        }
    }

    private func open(_ target: SessionTarget) {
        path.append(.session(machineId: target.machineId, session: target.session))
    }

    private var sections: [InboxSection] { model.inbox.sections(pinned: model.sessionPreferences.pinned) }

    private var rowKeys: [InboxRow.Key] { sections.flatMap { $0.rows.map(\.key) } }

    private var list: some View {
        List {
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
                Section {
                    ForEach(section.rows, id: \.key) { row in
                        NavigationLink(value: Route.session(machineId: row.machineId, session: row.session)) {
                            InboxRowView(
                                row: row, brand: model.brand(of: row.session, on: row.machineId),
                                machine: model.machine(id: row.machineId)?.summary,
                                pinned: model.sessionPreferences.pinned.contains(row.target),
                                muted: model.sessionPreferences.muted.contains(row.target))
                        }
                        .inboxRowActions(row, inbox: model.inbox, preferences: model.sessionPreferences)
                    }
                } header: {
                    InboxSectionHeader(
                        kind: section.kind, count: section.rows.count,
                        markAllSeen: section.kind == .state(.done) ? { model.inbox.markAllSeen() } : nil)
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if sections.isEmpty {
                InboxEmptyState(filter: model.inbox.filter, machines: model.machines, showAll: {
                    model.inbox.filter = nil
                }, startSession: { path.append(.newSession) })
            }
        }
        .refreshable { await model.inbox.refresh() }
        // Rows move, appear and leave with an animation, but a row's own text changing does not
        // animate the list, and nothing animates under a pushed chat.
        .animation(path.isEmpty ? Motion.snappy(reduceMotion: reduceMotion) : nil, value: rowKeys)
        .animation(path.isEmpty ? Motion.snappy(reduceMotion: reduceMotion) : nil, value: chips)
        .haptic(.failed, trigger: lostMachines, when: { $1 > $0 })
        .sensoryFeedback(trigger: model.inbox.lastAnswer) { _, answer in answer?.haptic.feedback }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            NavigationLink(value: Route.machines) {
                Label("Machines", systemImage: "laptopcomputer")
            }
        }
        if model.inbox.filter != nil {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Show All") { model.inbox.filter = nil }
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                path.append(.newSession)
            } label: {
                Label("New Session", systemImage: "square.and.pencil")
            }
            .buttonStyle(.glassProminent)
            .disabled(!model.machines.contains { $0.summary.isReady })
        }
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
            HStack(spacing: Spacing.s) {
                Text(title)
                Text(count, format: .number)
                    .foregroundStyle(.secondary)
            }
            .font(.subheadline.weight(.semibold))
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            if let markAllSeen {
                Spacer()
                Button("Mark All Read", action: markAllSeen)
                    .font(.subheadline)
                    .textCase(nil)
            }
        }
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
