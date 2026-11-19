import BroskiCore
import SwiftUI

/// New session, laid out as the chat it becomes: the question where the transcript will be, and
/// above the composer the folders this Mac's sessions ran in, with the agent and the folder as two
/// pills. Send creates the session and the screen turns into its chat in place, the first message
/// already on its way.
struct NewSessionScreen: View {
    @State private var model = NewSessionModel()
    @State private var created: SessionTarget?

    var body: some View {
        Group {
            if let created {
                ChatScreen(target: created)
                    .transition(.opacity)
            } else {
                NewSessionContent(model: model) { created = $0 }
            }
        }
        .animation(.easeOut(duration: 0.2), value: created)
    }
}

private struct NewSessionContent: View {
    @Bindable var model: NewSessionModel
    let created: (SessionTarget) -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var composing = false
    @State private var showsProjects = true
    @State private var browsing = false
    /// A folder came from the sheet: the keyboard comes up once the sheet has gone, over this screen.
    @State private var focusAfterSheet = false
    @State private var picks = 0

    private var machine: MachineModel? { model.machineId.flatMap(app.machine(id:)) }
    private var projects: [Project] { Project.recent(app.inbox.rows, machineId: model.machineId) }

    var body: some View {
        VStack(spacing: 0) {
            NewSessionHero(backend: model.backend)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(.rect)
                .onTapGesture { composing = false }
            bottomBar
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if let machine, !machine.summary.isReady {
                MachineStatusStrip(summary: machine.summary)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                NewSessionTitle(model: model)
            }
        }
        .toolbarVisibility(.hidden, for: .tabBar)
        .sheet(isPresented: $browsing, onDismiss: focusIfPicked) {
            if let machine {
                ProjectsSheet(
                    projects: projects, selected: model.folder, home: model.home,
                    requests: WorkspaceRequests(machine: machine.machine)
                ) { pick($0, fromSheet: true) }
            }
        }
        .haptic(.pickerStep, trigger: picks)
        .onChange(of: settleKey, initial: true) {
            model.settle(machines: app.machines, rows: app.inbox.rows)
        }
        .onChange(of: composing) { _, now in
            if now { showsProjects = false }
        }
        .task(id: machine?.id) {
            if let machine { await model.loadHome(machine.machine) }
        }
        .task(id: CatalogKey(backend: model.backend, folder: model.folder, changes: machine?.catalogChanges ?? 0)) {
            guard let machine, let backend = model.backend else { return }
            await model.catalog.load(machine.machine, backend: backend, cwd: model.folder, session: nil)
        }
    }

    private var bottomBar: some View {
        GlassEffectContainer(spacing: Spacing.xs) {
            VStack(alignment: .leading, spacing: Spacing.s) {
                if let problem = model.problem {
                    Banner(style: .error, message: problem.message, detail: problem.detail)
                }
                if showsProjects {
                    ProjectList(
                        projects: Array(projects.prefix(5)), selected: model.folder, home: model.home,
                        pick: { pick($0, fromSheet: false) }, browse: { browsing = true }
                    )
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                if let machine {
                    SessionPills(
                        machine: machine, backend: model.backend, folder: model.folder, showsProjects: showsProjects,
                        pickBackend: { model.pickBackend($0); picks += 1 },
                        toggleProjects: {
                            composing = false
                            showsProjects.toggle()
                        })
                    composer(machine)
                }
            }
        }
        .padding(.horizontal, Spacing.m)
        .padding(.bottom, Spacing.xs)
        .animation(reduceMotion ? .easeOut(duration: 0.14) : .spring(duration: 0.3, bounce: 0.12), value: showsProjects)
        .animation(.easeOut(duration: 0.2), value: model.problem?.message)
    }

    private func composer(_ machine: MachineModel) -> some View {
        let capabilities = machine.backends.first { $0.id == model.backend }?.capabilities
        let fileSearch: FileSearchSource? = model.folder.flatMap { folder in
            guard machine.summary.isReady else { return nil }
            let requests = WorkspaceRequests(machine: machine.machine)
            return FileSearchSource(root: folder) { query in
                guard let found = try? await requests.search(root: folder, query: query, limit: 15) else { return nil }
                return found.matches.map { $0.kind == .dir && !$0.path.hasSuffix("/") ? $0.path + "/" : $0.path }
            }
        }
        return ComposerView(
            draft: $model.draft, agent: model.backend?.displayName ?? "the agent", action: .send, modes: [.start],
            acceptsImages: capabilities?.attachments.contains(.image) ?? false,
            isEnabled: machine.summary.isReady && model.backend != nil && !model.isCreating,
            catalog: model.catalog, choices: model.choices, choose: model.choose(_:),
            perform: { _ in send(on: machine) }, refuse: model.report(_:), focus: $composing,
            dictation: .newSession(model, machine: machine, glance: app.dictation.glance),
            fileSearch: fileSearch)
    }

    private func pick(_ folder: String, fromSheet: Bool) {
        model.pickFolder(folder)
        picks += 1
        showsProjects = false
        if fromSheet {
            focusAfterSheet = true
        } else {
            composing = true
        }
    }

    private func focusIfPicked() {
        guard focusAfterSheet else { return }
        focusAfterSheet = false
        composing = true
    }

    /// Send with no folder yet opens the folders instead: a session needs somewhere to run.
    private func send(on machine: MachineModel) {
        guard model.folder != nil else {
            composing = false
            showsProjects = true
            return
        }
        Task {
            guard let target = await model.create(on: machine.machine, drafts: app.drafts) else { return }
            composing = false
            created(target)
        }
    }

    private var settleKey: SettleKey {
        SettleKey(
            machines: app.machines.map(\.id), ready: app.machines.filter(\.summary.isReady).map(\.id),
            rows: app.inbox.rows, folder: model.folder, backends: machine?.backends.map(\.id) ?? [],
            statuses: machine?.backendStatuses ?? [:])
    }

    private struct SettleKey: Equatable {
        let machines: [String]
        let ready: [String]
        let rows: [InboxRow]
        let folder: String?
        let backends: [BackendId]
        let statuses: [BackendId: BackendStatus]
    }

    private struct CatalogKey: Equatable {
        let backend: BackendId?
        let folder: String?
        let changes: Int
    }
}

/// Where the transcript will be: the agent's mark and the question, gone when the keyboard and the
/// folders leave no room for them.
private struct NewSessionHero: View {
    let backend: BackendId?

    var body: some View {
        ViewThatFits(in: .vertical) {
            VStack(spacing: Spacing.l) {
                Group {
                    if let backend {
                        AgentMark(backend: backend)
                    } else {
                        BroskiMark(side: 44)
                    }
                }
                .id(backend)
                .transition(.scale(scale: 0.8).combined(with: .opacity))
                Text("What should we build?")
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, Spacing.xl)
            .animation(.spring(duration: 0.3, bounce: 0.2), value: backend)
            Color.clear
        }
    }
}

/// "New Session" over the folder, and over the Mac too when several are paired, which is then a
/// menu to start on another.
private struct NewSessionTitle: View {
    let model: NewSessionModel
    @Environment(AppModel.self) private var app

    private var machine: MachineModel? { model.machineId.flatMap(app.machine(id:)) }

    var body: some View {
        if app.machines.count > 1 {
            Menu {
                Picker("Mac", selection: Binding { model.machineId ?? "" } set: { model.pickMachine($0) }) {
                    ForEach(app.machines) { machine in
                        Label(machine.name, systemImage: machine.summary.isReady ? "laptopcomputer" : "laptopcomputer.slash")
                            .tag(machine.id)
                    }
                }
            } label: {
                label(menu: true)
            }
            .accessibilityHint("Chooses the Mac")
        } else {
            label(menu: false)
        }
    }

    private func label(menu: Bool) -> some View {
        VStack(spacing: 0) {
            Text("New Session")
                .font(.headline)
                .foregroundStyle(.primary)
            HStack(spacing: Spacing.xxs) {
                Text(subtitle)
                    .lineLimit(1)
                if menu {
                    Image(systemName: "chevron.down")
                        .font(.caption2.weight(.semibold))
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: 260)
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        let folder = model.folder?.lastPathComponent ?? "Choose a folder"
        return app.machines.count > 1 ? [folder, machine?.name].compactMap(\.self).joined(separator: " · ") : folder
    }
}
