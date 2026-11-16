import BroskiCore
import SwiftUI
import UIKit

/// What the header asks before it acts.
enum ChatDialog: Identifiable {
    case rename
    case delete

    var id: Self { self }
}

/// The header's controls: the title (tap to rename), and one trailing cluster of Files for the
/// session's folder and the overflow (Fork, Rename, Compact, Copy Conversation, Delete) with the
/// context ring around it. Its dialogs hang on the screen (`chatDialogs`), not in the bar.
struct ChatToolbar: ToolbarContent {
    let chat: ChatModel
    let machine: MachineModel
    let title: String
    let cwd: String?
    let capabilities: Capabilities?
    @Binding var dialog: ChatDialog?
    @Environment(AppModel.self) private var app
    @Environment(\.openSession) private var openSession

    var body: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            ChatTitle(
                title: title, subtitle: subtitle, machineProblem: chat.connectionProblem(machine.summary),
                runStartedAt: chat.snapshot.run?.startedAt, canRename: capabilities?.rename ?? false
            ) {
                dialog = .rename
            }
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            if let cwd {
                Button {
                    app.folderToOpen = FolderTarget(machineId: machine.id, path: cwd)
                } label: {
                    Label("Files", systemImage: "folder")
                }
            }
            Menu {
                overflow
            } label: {
                ContextRing(fraction: chat.snapshot.usage?.contextFraction(window: nil))
                    .accessibilityLabel("More")
            }
        }
    }

    private var subtitle: String {
        [chat.session.backend.displayName, cwd?.lastPathComponent, machine.name].compactMap(\.self).joined(separator: " · ")
    }

    @ViewBuilder
    private var overflow: some View {
        if capabilities?.fork ?? false {
            Button("Fork", systemImage: "arrow.triangle.branch") {
                Task {
                    if let forked = await chat.fork() { openSession(SessionTarget(machineId: machine.id, session: forked)) }
                }
            }
        }
        if capabilities?.rename ?? false {
            Button("Rename", systemImage: "pencil") { dialog = .rename }
        }
        if chat.state.capabilities?.compact ?? false {
            Button("Compact", systemImage: "rectangle.compress.vertical") { Task { await chat.compact() } }
        }
        Button("Copy Conversation", systemImage: "doc.on.doc") {
            UIPasteboard.general.string = chat.conversationText
            chat.play(.confirmed)
        }
        if capabilities?.delete ?? false {
            Divider()
            Button("Delete", systemImage: "trash", role: .destructive) { dialog = .delete }
        }
    }
}

/// Rename (a title field) and Delete (a confirmation) for the chat's header.
private struct ChatDialogs: ViewModifier {
    let chat: ChatModel
    let machineName: String
    let title: String
    @Binding var dialog: ChatDialog?
    @State private var newTitle = ""
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
                    Task { if await chat.delete() { dismiss() } }
                }
            } message: {
                Text("\(chat.session.backend.displayName) deletes it on \(machineName).")
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
    func chatDialogs(_ chat: ChatModel, machineName: String, title: String, dialog: Binding<ChatDialog?>) -> some View {
        modifier(ChatDialogs(chat: chat, machineName: machineName, title: title, dialog: dialog))
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
