import BroskiCore
import SwiftUI

/// New session as a prompt, not a form (other clients's draft screen): "What should we build in
/// <folder>?" with the folder a menu of recent ones and a browser, the Mac under it when there are
/// several, the agent as an inline picker, and the composer with its chips, keyboard up.
struct NewSessionSheet: View {
    let created: (SessionTarget) -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var model = NewSessionModel()
    @State private var browsing = false
    @FocusState private var composing: Bool

    private var machine: MachineModel? { model.machineId.flatMap(app.machine(id:)) ?? app.machines.first }

    var body: some View {
        NavigationStack {
            VStack(spacing: Spacing.l) {
                Spacer(minLength: Spacing.l)
                prompt
                Spacer(minLength: Spacing.l)
                if let machine {
                    AgentPicker(machine: machine, selection: $model.backend)
                }
                if let problem = model.problem {
                    Banner(style: .error, message: problem.message, detail: problem.detail)
                }
                composer
            }
            .padding(.horizontal, Spacing.m)
            .padding(.bottom, Spacing.s)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) { dismiss() }
                }
            }
            .navigationDestination(isPresented: $browsing) {
                if let machine {
                    FolderBrowser(requests: WorkspaceRequests(machine: machine.machine), roots: model.roots) { folder in
                        model.folder = folder
                        browsing = false
                    }
                }
            }
        }
        .presentationDetents([.large])
        .task(id: machine?.id) { await setUp() }
        .task(id: CatalogKey(backend: model.backend, folder: model.folder, changes: machine?.catalogChanges ?? 0)) {
            guard let machine, let backend = model.backend else { return }
            await model.catalog.load(machine.machine, backend: backend, cwd: model.folder, session: nil)
        }
        .task {
            // Focus taken while the sheet still slides in is dropped; it holds once the sheet is up.
            try? await Task.sleep(for: .milliseconds(450))
            composing = true
        }
    }

    private struct CatalogKey: Equatable {
        let backend: BackendId?
        let folder: String?
        let changes: Int
    }

    private func setUp() async {
        guard let machine else { return }
        model.machineId = machine.id
        if model.backend == nil || !machine.backends.contains(where: { $0.id == model.backend }) {
            model.backend = NewSessionModel.defaultBackend(machine)
        }
        model.folder = NewSessionModel.recentFolders(app.inbox.rows, machineId: machine.id).first
        await model.loadRoots(machine.machine)
    }

    private var prompt: some View {
        VStack(spacing: Spacing.s) {
            Text("What should we build")
            HStack(spacing: Spacing.s) {
                Text("in")
                FolderMenu(
                    folder: model.folder, recent: NewSessionModel.recentFolders(app.inbox.rows, machineId: machine?.id),
                    choose: { model.folder = $0 }, browse: { browsing = true })
            }
            if app.machines.count > 1, let machine {
                Menu {
                    Picker("Mac", selection: Binding { machine.id } set: { model.machineId = $0 }) {
                        ForEach(app.machines) { Text($0.name).tag($0.id) }
                    }
                } label: {
                    Label("on \(machine.name)", systemImage: "laptopcomputer")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .font(.title2)
        .multilineTextAlignment(.center)
    }

    @ViewBuilder
    private var composer: some View {
        if let machine {
            let capabilities = machine.backends.first { $0.id == model.backend }?.capabilities
            ComposerView(
                draft: $model.draft, agent: model.backend?.displayName ?? "the agent", action: .send, modes: [.start],
                acceptsImages: capabilities?.attachments.contains(.image) ?? false,
                isEnabled: machine.summary.isReady && model.backend != nil && model.folder != nil,
                catalog: model.catalog, choices: model.choices, choose: model.choose(_:),
                perform: { _ in create(on: machine) }, refuse: { _ in }, focus: $composing)
        }
    }

    private func create(on machine: MachineModel) {
        Task {
            guard let target = await model.create(on: machine.machine, drafts: app.drafts) else { return }
            dismiss()
            created(target)
        }
    }
}

/// The folder in the prompt: the last folder name, underlined, a menu of recent folders and Browse.
private struct FolderMenu: View {
    let folder: String?
    let recent: [String]
    let choose: (String) -> Void
    let browse: () -> Void

    var body: some View {
        Menu {
            if !recent.isEmpty {
                Section("Recent") {
                    ForEach(recent.prefix(6), id: \.self) { path in
                        Button { choose(path) } label: {
                            Text(path.lastPathComponent)
                            Text(path)
                        }
                    }
                }
            }
            Button("Browse…", systemImage: "folder", action: browse)
        } label: {
            Text((folder?.lastPathComponent ?? "a folder") + "?")
                .underline(pattern: .dot)
                .foregroundStyle(.primary)
        }
        .accessibilityLabel("Folder, \(folder ?? "none chosen")")
    }
}
