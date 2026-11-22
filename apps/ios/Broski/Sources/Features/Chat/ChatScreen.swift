import BroskiCore
import SwiftUI

/// A session's chat. Layout, bottom to top: the composer, the pinned panel above it, the transcript
/// full bleed under the bar and the composer, the header.
struct ChatScreen: View {
    let target: SessionTarget
    @Environment(AppModel.self) private var app

    var body: some View {
        if let machine = app.machine(id: target.machineId) {
            ChatContent(machine: machine, target: target, drafts: app.drafts)
        } else {
            ContentUnavailableView(
                "This Mac isn't paired anymore", systemImage: "laptopcomputer.slash",
                description: Text("Pair it again from Machines to open its sessions."))
        }
    }
}

private struct ChatContent: View {
    let machine: MachineModel
    @State private var chat: ChatModel
    @State private var catalog = ComposerCatalog()
    @State private var disclosure = Disclosure()
    @State private var position = ScrollPosition(idType: String.self, edge: .bottom)
    @State private var dialog: ChatDialog?
    @State private var composing = false
    /// Set by Mark as Unread, which leaves the chat: leaving must not mark the session seen again.
    @State private var leftUnread = false
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    /// SwiftUI keeps the model of the first init for the screen's life, which is the one handed the
    /// first prompt of a session just created.
    init(machine: MachineModel, target: SessionTarget, drafts: DraftStore) {
        self.machine = machine
        let core = machine.machine
        _chat = State(
            initialValue: ChatModel(
                target: target, requests: ChatRequests(machine: core), workspace: WorkspaceRequests(machine: core),
                drafts: drafts, firstPrompt: drafts.takeFirstPrompt(for: target)
            ) { try core.attach(session: $0) })
    }

    private var row: InboxRow? {
        app.inbox.rows.first { $0.machineId == machine.id && $0.session == chat.session }
    }

    private var cwd: String? { chat.summary?.cwd ?? row?.cwd }
    private var title: String { chat.renamedTitle ?? row?.title ?? chat.summary?.title?.text ?? "New session" }
    private var agent: String { machine.brand(for: chat.session.backend).name }
    private var capabilities: Capabilities? { machine.descriptor(for: chat.session.backend)?.capabilities }

    var body: some View {
        TranscriptView(
            chat: chat, dimmed: chat.connectionProblem(machine.summary) != nil, connection: chat.connectionProblem(machine.summary),
            dismissKeyboard: { composing = false }, position: $position)
            .safeAreaBar(edge: .bottom) {
                ChatBottomBar(
                    chat: chat, catalog: catalog, agent: agent, capabilities: capabilities,
                    isReady: chat.connectionProblem(machine.summary) == nil, dictation: dictationTarget,
                    fileSearch: fileSearchSource, position: $position,
                    composing: $composing)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ChatToolbar(
                    chat: chat, machine: machine, title: title, cwd: cwd, capabilities: capabilities,
                    markUnread: unreadAction, dialog: $dialog)
            }
            .chatDialogs(chat, agent: agent, machineName: machine.name, title: title, dialog: $dialog)
            .sheet(isPresented: showingInfo) {
                SessionInfoSheet(chat: chat, machine: machine, title: title, cwd: cwd, catalog: catalog)
            }
            .cacheExpiryClock(chat.snapshot.usage?.cache)
            .toolbarVisibility(.hidden, for: .tabBar)
            .environment(disclosure)
            .environment(\.chatMachineId, machine.id)
            .environment(\.formatContext, FormatContext(machineId: machine.id, cwd: cwd))
            .environment(\.chatImages, chat.imageStore)
            .onChange(of: machine.summary.isReady) { wasReady, isReady in
                if !wasReady && isReady { chat.imageStore.retryFailed() }
            }
            .sensoryFeedback(trigger: chat.feedback) { _, feedback in feedback?.moment.feedback }
            .onAppear { chat.start() }
            .task {
                // After the push settles: these change the tab bar's accessory and the inbox
                // behind the chat, which must not move while the push runs.
                try? await Task.sleep(for: .milliseconds(450))
                guard !Task.isCancelled, !leftUnread else { return }
                app.visibleSession = chat.target
                app.markSeen(machineId: machine.id, session: chat.session)
            }
            .onDisappear {
                if app.visibleSession == chat.target { app.visibleSession = nil }
                if !leftUnread { app.markSeen(machineId: machine.id, session: chat.session) }
            }
            .task { await chat.loadSummary() }
            .task(id: CatalogKey(session: chat.session, cwd: cwd, changes: machine.catalogChanges)) {
                await catalog.load(machine.machine, backend: chat.session.backend, cwd: cwd, session: chat.session)
            }
    }

    private var showingInfo: Binding<Bool> {
        Binding { dialog == .info } set: { if !$0 { dialog = nil } }
    }

    /// Offered while the session is settled; leaves the chat once marked.
    private var unreadAction: (() -> Void)? {
        guard row?.state == .idle || row?.state == .done else { return nil }
        return {
            leftUnread = true
            app.markUnread(machineId: machine.id, session: chat.session)
            dismiss()
        }
    }

    private var fileSearchSource: FileSearchSource? {
        guard let cwd, machine.summary.isReady else { return nil }
        let requests = WorkspaceRequests(machine: machine.machine)
        return FileSearchSource(root: cwd) { query in
            guard let found = try? await requests.search(root: cwd, query: query, limit: 15) else { return nil }
            return found.matches.map { $0.kind == .dir && !$0.path.hasSuffix("/") ? $0.path + "/" : $0.path }
        }
    }

    /// Dictated text goes into this chat's draft; "send after dictating" sends it as the button would.
    private var dictationTarget: DictationTarget {
        let modes = capabilities?.promptModes ?? [.start]
        return .chat(chat, cwd: { [cwd] in cwd }, machine: machine, glance: app.dictation.glance) { [chat] in
            let action = SendAction.resolve(running: chat.isRunning, hasContent: chat.draft.hasContent, modes: modes)
            guard action.mode != nil else { return }
            Task { await chat.send(action) }
        }
    }

    private struct CatalogKey: Equatable {
        let session: SessionRef
        let cwd: String?
        let changes: Int
    }
}

extension ChatModel {
    /// Why what the chat shows may not be the session as it is now: the Mac out of reach, or the
    /// view attaching again once it is. A view that ended says so in its own card.
    func connectionProblem(_ machine: MachineSummary) -> String? {
        if !machine.isReady { return machine.line }
        return isLive || viewEnd != nil ? nil : "Reconnecting to this session…"
    }
}
