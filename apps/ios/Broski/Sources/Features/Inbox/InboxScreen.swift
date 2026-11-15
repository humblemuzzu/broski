import BroskiCore
import SwiftUI

/// Home: every session on every paired Mac, needs you → working → done → idle, under the status of
/// any machine that is not fine.
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
    }

    private var sections: [InboxSection] { model.inbox.sections }

    private var list: some View {
        List {
            if !chips.isEmpty {
                MachineChips(chips: chips)
            }
            ForEach(sections) { section in
                Section {
                    ForEach(section.rows, id: \.key) { row in
                        InboxRowView(row: row, machine: model.machine(id: row.machineId)?.summary)
                    }
                } header: {
                    InboxSectionHeader(state: section.state, count: section.rows.count)
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if sections.isEmpty {
                InboxEmptyState(filter: model.inbox.filter, machines: model.machines) {
                    model.inbox.filter = nil
                }
            }
        }
        .refreshable { await model.reconnect() }
        .animation(Motion.snappy(reduceMotion: reduceMotion), value: sections)
        .animation(Motion.snappy(reduceMotion: reduceMotion), value: chips)
        .haptic(.failed, trigger: lostMachines, when: { $1 > $0 })
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
    let state: InboxState
    let count: Int

    var body: some View {
        HStack(spacing: Spacing.s) {
            Text(state.title)
            Text(count, format: .number)
                .foregroundStyle(.secondary)
        }
        .font(.subheadline.weight(.semibold))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
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
