import BroskiCore
import SwiftUI

/// The inbox's one filter control: a glass button in the bar, filled while a filter is on, opening a
/// menu: working sessions only, then the agents the Macs run, the folders sessions ran in lately, and
/// the Macs once there are two, each a picker whose choice the menu shows beside its name.
struct InboxFilterMenu: View {
    @Environment(AppModel.self) private var model
    @State private var steps = 0

    /// The most folders the menu offers, newest first.
    static let folders = 8

    private var filter: InboxFilter { model.inbox.filter }

    private var agents: [(id: String, name: String)] {
        var seen = Set<String>()
        return model.machines.flatMap(\.backends).compactMap { descriptor in
            seen.insert(descriptor.id).inserted ? (descriptor.id, AgentBrand(descriptor).name) : nil
        }
    }

    private var recentFolders: [String] {
        var seen = Set<String>()
        let folders = model.inbox.rows.sorted { $0.updatedAt > $1.updatedAt }.compactMap { row in
            row.cwd.flatMap { seen.insert($0).inserted ? $0 : nil }
        }
        let shown = Array(folders.prefix(Self.folders))
        guard let chosen = filter.folder, !shown.contains(chosen) else { return shown }
        return [chosen] + shown
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
            Picker("Project", selection: binding(\.folder)) {
                Text("All Projects").tag(String?.none)
                ForEach(recentFolders, id: \.self) { Text(URL(fileURLWithPath: $0).lastPathComponent).tag(Optional($0)) }
            }
            .pickerStyle(.menu)
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
