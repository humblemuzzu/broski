import BroskiCore
import SwiftUI

/// Home: every session on every paired Mac, needs you → working → done → idle, under the status of
/// any machine that is not fine. A row opens its chat, zooming out of the row; New Session opens the
/// prompt sheet, and the session it makes opens zooming out of the button.
struct InboxScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var path: [Route] = []
    @State private var startingSession = false
    /// The session New Session made, the zoom source id of its button until the next one.
    @State private var created: SessionTarget?
    @Namespace private var zoom

    var body: some View {
        NavigationStack(path: $path) {
            list
                .navigationTitle(model.inbox.filter.map(\.title) ?? "Inbox")
                .toolbar { toolbar }
                .routeDestinations()
        }
        .environment(\.zoomNamespace, zoom)
        .environment(\.openSession, OpenSessionAction { open($0) })
        .sheet(isPresented: $startingSession) {
            NewSessionSheet { target in
                created = target
                open(target)
            }
        }
        .onChange(of: model.sessionToOpen, initial: true) { _, target in
            guard let target else { return }
            path = [.session(machineId: target.machineId, session: target.session)]
            model.sessionToOpen = nil
        }
    }

    private func open(_ target: SessionTarget) {
        path.append(.session(machineId: target.machineId, session: target.session))
    }

    private var sections: [InboxSection] { model.inbox.sections }

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
                            InboxRowView(row: row, machine: model.machine(id: row.machineId)?.summary)
                        }
                        .matchedTransitionSource(id: SessionTarget(machineId: row.machineId, session: row.session), in: zoom)
                        .inboxRowActions(row, inbox: model.inbox)
                    }
                } header: {
                    InboxSectionHeader(state: section.state, count: section.rows.count)
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if sections.isEmpty {
                InboxEmptyState(filter: model.inbox.filter, machines: model.machines, showAll: {
                    model.inbox.filter = nil
                }, startSession: { startingSession = true })
            }
        }
        .refreshable { await model.inbox.refresh() }
        .animation(Motion.snappy(reduceMotion: reduceMotion), value: sections)
        .animation(Motion.snappy(reduceMotion: reduceMotion), value: chips)
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
                startingSession = true
            } label: {
                Label("New Session", systemImage: "square.and.pencil")
            }
            .buttonStyle(.glassProminent)
            .disabled(!model.machines.contains { $0.summary.isReady })
        }
        .matchedTransitionSource(id: created ?? newSessionSource, in: zoom)
    }

    /// The button's zoom id before it has made any session.
    private var newSessionSource: SessionTarget {
        SessionTarget(machineId: "", session: SessionRef(backend: .pi, sessionId: "new-session"))
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
