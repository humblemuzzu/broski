import BroskiCore
import SwiftUI
import UIKit

/// What the header asks or shows before it acts.
enum ChatDialog: Identifiable {
    case rename
    case delete
    case info

    var id: Self { self }
}

/// The header's controls: the title (tap to rename), and one trailing cluster of Files for the
/// session's folder and the overflow with the context ring around it: the session's own marks
/// (Pin, Rename, Copy Session ID, Mark as Unread, Mute), then what acts on its conversation
/// (Compact, Fork, Export, Session Info), then Delete. Its dialogs hang on the screen
/// (`chatDialogs`), not in the bar.
struct ChatToolbar: ToolbarContent {
    let chat: ChatModel
    let machine: MachineModel
    let title: String
    let cwd: String?
    let capabilities: Capabilities?
    /// Set while the session is settled: marks it unread and leaves the chat.
    let markUnread: (() -> Void)?
    @Binding var dialog: ChatDialog?
    @Environment(AppModel.self) private var app
    @Environment(\.openSession) private var openSession

    var body: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            let blocked = chat.snapshot.interactions.contains(where: \.blocksRun)
            ChatTitle(
                title: title, subtitle: subtitle, machineProblem: chat.connectionProblem(machine.summary),
                runStartedAt: blocked ? nil : chat.snapshot.run?.startedAt, cache: chat.snapshot.usage?.cache,
                canRename: capabilities?.rename ?? false
            ) {
                dialog = .rename
            }
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            if let cwd {
                NavigationLink(value: Route.workspace(machineId: machine.id, place: .folder(cwd))) {
                    Label("Files", systemImage: "folder")
                }
            }
            Menu {
                marks
                actions
                if capabilities?.delete ?? false {
                    Section {
                        Button("Delete Session", systemImage: "trash", role: .destructive) { dialog = .delete }
                    }
                }
            } label: {
                ContextRing(fraction: chat.snapshot.usage?.contextFraction(window: nil))
                    .accessibilityLabel("More")
            }
        }
    }

    private var subtitle: String {
        [machine.brand(for: chat.session.backend).name, cwd?.lastPathComponent, machine.name].compactMap(\.self).joined(separator: " · ")
    }

    private var preferences: SessionPreferences { app.sessionPreferences }

    private var marks: some View {
        Section {
            let pinned = preferences.pinned.contains(chat.target)
            Button(pinned ? "Unpin" : "Pin", systemImage: pinned ? "pin.slash" : "pin") {
                preferences.setPinned(!pinned, chat.target)
            }
            if capabilities?.rename ?? false {
                Button("Rename", systemImage: "pencil") { dialog = .rename }
            }
            Button("Copy Session ID", systemImage: "number") {
                UIPasteboard.general.string = chat.session.sessionId
                chat.play(.confirmed)
            }
            if let markUnread {
                Button("Mark as Unread", systemImage: "envelope.badge", action: markUnread)
            }
            let muted = preferences.muted.contains(chat.target)
            Button(muted ? "Unmute" : "Mute", systemImage: muted ? "bell" : "bell.slash") {
                preferences.setMuted(!muted, chat.target)
            }
        }
    }

    private var actions: some View {
        Section {
            if chat.state.capabilities?.compact ?? false {
                Button("Compact", systemImage: "rectangle.compress.vertical") { Task { await chat.compact() } }
            }
            if capabilities?.fork ?? false {
                Button("Fork", systemImage: "arrow.triangle.branch") {
                    Task {
                        if let forked = await chat.fork() { openSession(SessionTarget(machineId: machine.id, session: forked)) }
                    }
                }
            }
            Menu("Export", systemImage: "square.and.arrow.up.on.square") {
                ShareLink(item: chat.conversation, subject: Text(title), preview: SharePreview(title)) {
                    Label("Share Markdown", systemImage: "square.and.arrow.up")
                }
                Button("Copy Conversation", systemImage: "doc.on.doc") {
                    UIPasteboard.general.string = chat.conversation.text
                    chat.play(.confirmed)
                }
            }
            Button("Session Info", systemImage: "info.circle") { dialog = .info }
        }
    }
}

/// Rename (a title field) and Delete (a confirmation) for the chat's header.
private struct ChatDialogs: ViewModifier {
    let chat: ChatModel
    let agent: String
    let machineName: String
    let title: String
    @Binding var dialog: ChatDialog?
    @State private var newTitle = ""
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    func body(content: Content) -> some View {
        content
            .alert("Rename Session", isPresented: showing(.rename)) {
                TextField("Title", text: $newTitle)
                Button("Rename") { Task { await chat.rename(to: newTitle) } }
                Button("Cancel", role: .cancel) {}
            }
            .confirmationDialog("Delete this session?", isPresented: showing(.delete), titleVisibility: .visible) {
                Button("Delete Session", role: .destructive) {
                    Task {
                        guard await chat.delete() else { return }
                        app.sessionDeleted(chat.target)
                        dismiss()
                    }
                }
            } message: {
                Text("\(agent) deletes it on \(machineName).")
            }
            .onChange(of: dialog) { _, shown in
                if shown == .rename { newTitle = title }
            }
    }

    private func showing(_ kind: ChatDialog) -> Binding<Bool> {
        Binding { dialog == kind } set: { if !$0 { dialog = nil } }
    }
}

extension View {
    func chatDialogs(
        _ chat: ChatModel, agent: String, machineName: String, title: String, dialog: Binding<ChatDialog?>
    ) -> some View {
        modifier(ChatDialogs(chat: chat, agent: agent, machineName: machineName, title: title, dialog: dialog))
    }
}

/// Opens a session on the stack the chat is on (a fork); the inbox provides it.
struct OpenSessionAction {
    let open: @MainActor (SessionTarget) -> Void

    func callAsFunction(_ target: SessionTarget) {
        open(target)
    }
}

extension EnvironmentValues {
    @Entry var openSession = OpenSessionAction { _ in }
}
