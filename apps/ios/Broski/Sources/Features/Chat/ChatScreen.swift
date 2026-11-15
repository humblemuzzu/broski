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
    @FocusState private var composing: Bool
    @Environment(AppModel.self) private var app

    /// SwiftUI keeps the model of the first init for the screen's life, which is the one handed the
    /// first prompt of a session just created.
    init(machine: MachineModel, target: SessionTarget, drafts: DraftStore) {
        self.machine = machine
        let core = machine.machine
        _chat = State(
            initialValue: ChatModel(
                target: target, requests: ChatRequests(machine: core), drafts: drafts,
                firstPrompt: drafts.takeFirstPrompt(for: target)
            ) { try core.attach(session: $0) })
    }

    private var row: InboxRow? {
        app.inbox.rows.first { $0.machineId == machine.id && $0.session == chat.session }
    }

    private var cwd: String? { chat.summary?.cwd ?? row?.cwd }
    private var title: String { chat.renamedTitle ?? row?.title ?? chat.summary?.title?.text ?? "New session" }
    private var agent: String { chat.session.backend.displayName }
    private var capabilities: Capabilities? { machine.backends.first { $0.id == chat.session.backend }?.capabilities }

    var body: some View {
        TranscriptView(chat: chat, dimmed: !machine.summary.isReady, dismissKeyboard: { composing = false }, position: $position)
            .safeAreaBar(edge: .bottom) {
                ChatBottomBar(
                    chat: chat, catalog: catalog, agent: agent, capabilities: capabilities,
                    isReady: machine.summary.isReady, position: $position, composing: $composing)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ChatToolbar(chat: chat, machine: machine, title: title, cwd: cwd, capabilities: capabilities, dialog: $dialog)
            }
            .chatDialogs(chat, machineName: machine.name, title: title, dialog: $dialog)
            .toolbarVisibility(.hidden, for: .tabBar)
            .environment(disclosure)
            .environment(\.chatMachineId, machine.id)
            .environment(\.loadAttachment, AttachmentLoader { await chat.image($0) })
            .sensoryFeedback(trigger: chat.feedback) { _, feedback in feedback?.moment.feedback }
            .onAppear {
                chat.start()
                app.visibleSession = chat.target
                app.markSeen(machineId: machine.id, session: chat.session)
            }
            .onDisappear {
                if app.visibleSession == chat.target { app.visibleSession = nil }
                app.markSeen(machineId: machine.id, session: chat.session)
            }
            .task { await chat.loadSummary() }
            .task(id: CatalogKey(session: chat.session, cwd: cwd, changes: machine.catalogChanges)) {
                await catalog.load(machine.machine, backend: chat.session.backend, cwd: cwd, session: chat.session)
            }
    }

    private struct CatalogKey: Equatable {
        let session: SessionRef
        let cwd: String?
        let changes: Int
    }
}
