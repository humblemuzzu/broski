import BroskiCore
import SwiftUI

/// The Workspace tab: one machine's folders and terminals, the machine chosen from the title when
/// several are paired. A folder another screen asks for (`AppModel.folderToOpen`) opens here.
struct WorkspaceScreen: View {
    @Environment(AppModel.self) private var model
    @State private var navigation = WorkspaceNavigation()

    var body: some View {
        NavigationStack(path: $navigation.path) {
            Group {
                if let machine = navigation.machine(in: model.machines) {
                    WorkspaceHome(machine: machine)
                        .id(machine.id)
                        .navigationTitle(model.machines.count > 1 ? machine.name : "Workspace")
                        .toolbarTitleMenu { machinePicker }
                } else {
                    ContentUnavailableView(
                        "No Mac paired", systemImage: "laptopcomputer",
                        description: Text("Pair a Mac to browse its files, git and terminals."))
                        .navigationTitle("Workspace")
                }
            }
            .routeDestinations()
        }
        .onChange(of: model.folderToOpen, initial: true) { _, target in
            guard let target else { return }
            navigation.open(target)
            model.folderToOpen = nil
        }
    }

    @ViewBuilder
    private var machinePicker: some View {
        if model.machines.count > 1 {
            Picker(
                "Mac",
                selection: Binding {
                    navigation.machine(in: model.machines)?.id ?? ""
                } set: {
                    navigation.choose($0)
                }
            ) {
                ForEach(model.machines) { machine in
                    Label(machine.name, systemImage: machine.summary.isReady ? "laptopcomputer" : "laptopcomputer.slash")
                        .tag(machine.id)
                }
            }
        }
    }
}

/// One machine: its status when it cannot be reached, its folders, its terminals.
private struct WorkspaceHome: View {
    let machine: MachineModel
    @State private var home: WorkspaceHomeModel
    @State private var closing: TerminalSummary?

    init(machine: MachineModel) {
        self.machine = machine
        _home = State(initialValue: WorkspaceHomeModel(requests: WorkspaceRequests(machine: machine.machine)))
    }

    private var reachable: Bool { machine.summary.isReady }

    var body: some View {
        List {
            if !reachable {
                Section {
                    StatusChip(text: machine.summary.line, tone: machine.summary.health.tone)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
            }
            if let problem = home.problem {
                Banner(problem: problem)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            if let info = home.info {
                FoldersSection(machineId: machine.id, roots: info.roots)
                TerminalsSection(machineId: machine.id, info: info, home: home, closing: $closing)
            } else if reachable && home.problem == nil {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .listStyle(.insetGrouped)
        .dimmed(!reachable)
        .disabled(!reachable)
        .environment(\.workspaceReachable, reachable)
        .refreshable { await home.load() }
        .task(id: reachable) {
            guard reachable else { return }
            await home.load()
        }
        .confirmationDialog(
            "Close this terminal?", isPresented: Binding { closing != nil } set: { if !$0 { closing = nil } },
            titleVisibility: .visible, presenting: closing
        ) { terminal in
            Button("Close Terminal", role: .destructive) { Task { await home.close(terminal) } }
        } message: { _ in
            Text("What runs in it ends.")
        }
        .haptic(.destructive, trigger: home.terminals.count) { $1 < $0 }
    }
}

private struct FoldersSection: View {
    let machineId: String
    let roots: [String]

    var body: some View {
        Section("Folders") {
            ForEach(roots, id: \.self) { root in
                NavigationLink(value: Route.workspace(machineId: machineId, place: .folder(root))) {
                    Label {
                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            Text(root.lastPathComponent).font(.body.weight(.medium))
                            Text(root).font(.footnote).foregroundStyle(.secondary).lineLimit(1).truncationMode(.head)
                        }
                    } icon: {
                        Image(systemName: "folder.fill").foregroundStyle(Palette.accent)
                    }
                }
                .accessibilityLabel("Folder, \(root)")
            }
        }
    }
}
