import BroskiCore
import SwiftUI

/// The inbox's one filter control: a glass button in the bar, filled while a filter is on, opening a
/// menu: working sessions only, then the agents the Macs run, the folders sessions ran in lately, and
/// the Macs once there are two, each a picker whose choice the menu shows beside its name.
struct InboxFilterMenu: View {
    @Environment(AppModel.self) private var model
    @State private var steps = 0

    /// The most recent folders the menu offers first, newest first; the rest are under More Projects.
    static let recentFolders = 8

    private var filter: InboxFilter { model.inbox.filter }

    private var agents: [(id: String, name: String)] {
        var seen = Set<String>()
        return model.machines.flatMap(\.backends).compactMap { descriptor in
            seen.insert(descriptor.id).inserted ? (descriptor.id, AgentBrand(descriptor).name) : nil
        }
    }

    /// The folders the rows ran in: the most recent first, the chosen one among them, and the rest by
    /// name. One pass over the rows, which may be thousands.
    static func folderChoices(_ rows: [InboxRow], chosen: String?) -> (recent: [String], others: [String]) {
        var newest: [String: Int64] = [:]
        for row in rows {
            if let cwd = row.cwd { newest[cwd] = max(newest[cwd] ?? .min, row.updatedAt) }
        }
        let byRecency = newest.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }.map(\.key)
        var recent = Array(byRecency.prefix(recentFolders))
        if let chosen, !recent.contains(chosen) { recent.insert(chosen, at: 0) }
        let others = byRecency.dropFirst(recentFolders).filter { $0 != chosen }
            .sorted { name($0).localizedStandardCompare(name($1)) == .orderedAscending }
        return (recent, others)
    }

    private static func name(_ folder: String) -> String {
        URL(fileURLWithPath: folder).lastPathComponent
    }

    var body: some View {
        Menu {
            Toggle("Working Only", isOn: Binding {
                filter.state == .working
            } set: { on in
                steps += 1
                model.inbox.filter.state = on ? .working : nil
            })
            if agents.count > 1 {
                Picker("Agent", selection: binding(\.backend)) {
                    Text("All Agents").tag(String?.none)
                    ForEach(agents, id: \.id) { Text($0.name).tag(Optional($0.id)) }
                }
                .pickerStyle(.menu)
            }
            let folders = Self.folderChoices(model.inbox.rows, chosen: filter.folder)
            Picker("Project", selection: binding(\.folder)) {
                Text("All Projects").tag(String?.none)
                ForEach(folders.recent, id: \.self) { Text(Self.name($0)).tag(Optional($0)) }
            }
            .pickerStyle(.menu)
            if !folders.others.isEmpty {
                Menu("More Projects") {
                    Picker("More Projects", selection: binding(\.folder)) {
                        ForEach(folders.others, id: \.self) { Text(Self.name($0)).tag(Optional($0)) }
                    }
                }
            }
            if model.machines.count > 1 {
                Picker("Mac", selection: binding(\.machineId)) {
                    Text("All Macs").tag(String?.none)
                    ForEach(model.machines) { Text($0.name).tag(Optional($0.id)) }
                }
                .pickerStyle(.menu)
            }
            if filter.isActive {
                Section {
                    Button("Clear Filters") {
                        steps += 1
                        model.inbox.filter = InboxFilter()
                    }
                }
            }
        } label: {
            Image(systemName: filter.isActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease")
                .contentTransition(.symbolEffect(.replace))
        }
        .accessibilityLabel(filter.isActive ? "Filters, on" : "Filters")
        .sensoryFeedback(.selection, trigger: steps)
    }

    private func binding(_ key: WritableKeyPath<InboxFilter, String?>) -> Binding<String?> {
        Binding {
            model.inbox.filter[keyPath: key]
        } set: { value in
            guard value != model.inbox.filter[keyPath: key] else { return }
            steps += 1
            model.inbox.filter[keyPath: key] = value
        }
    }
}

extension InboxFilter {
    /// What the inbox is narrowed to, for the line under its title: "Working · Pi · broski".
    func summary(machines: [MachineModel]) -> String? {
        let agent = backend.map { id in
            machines.lazy.flatMap(\.backends).first { $0.id == id }.map { AgentBrand($0).name } ?? AgentBrand(backend: id).name
        }
        let mac = machineId.flatMap { id in machines.first { $0.id == id }?.name }
        let parts = [state?.title, agent, mac, folder.map { URL(fileURLWithPath: $0).lastPathComponent }].compactMap(\.self)
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
