import BroskiCore
import SwiftUI

struct ScreenFeatureView: View {
    let machineId: String
    @Environment(AppModel.self) private var appModel
    @Environment(\.dismiss) private var dismiss
    @State private var model: ScreenModel
    @State private var showingPasswordSheet = false
    @State private var showingTextSheet = false
    @State private var showToolbar = true

    init(machineId: String) {
        self.machineId = machineId
        _model = State(initialValue: ScreenModel(machineId: machineId))
    }

    private var machine: MachineModel? {
        appModel.machine(id: machineId)
    }

    var body: some View {
        VStack(spacing: 0) {
            content
            if showToolbar, case .live = model.phase {
                ScreenToolbarView(
                    model: model,
                    onPasswordTap: { showingPasswordSheet = true },
                    onTypeTextTap: { showingTextSheet = true }
                )
            }
        }
        .navigationTitle(model.desktopName.isEmpty ? (machine?.name ?? "Mac Screen") : model.desktopName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarVisibility(.hidden, for: .tabBar)
        .toolbar { toolbarItems }
        .onAppear(perform: connectOnAppear)
        .onDisappear { model.disconnect() }
        .sheet(isPresented: authPresented) { authSheet }
        .sheet(isPresented: $showingPasswordSheet) { textSheet(isPassword: true) }
        .sheet(isPresented: $showingTextSheet) { textSheet(isPassword: false) }
    }

    @ToolbarContentBuilder
    private var toolbarItems: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            if case .live = model.phase {
                Button {
                    showToolbar.toggle()
                } label: {
                    Image(systemName: showToolbar ? "keyboard.chevron.compact.down" : "keyboard")
                }
                Button {
                    model.refresh()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                if model.hasSavedCredentials {
                    Menu {
                        Button("Forget Saved Login", systemImage: "key.slash", role: .destructive) {
                            model.forgetSavedCredentials()
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var authSheet: some View {
        if case .authRequired(let schemes, let errorMessage) = model.phase {
            ScreenAuthSheet(
                machineName: machine?.name ?? "your Mac",
                schemes: schemes,
                initialUsername: model.savedUsername,
                errorMessage: errorMessage,
                onSubmit: { user, pass, remember in model.submitCredentials(username: user, password: pass, remember: remember) },
                onCancel: { dismiss() }
            )
            .presentationDetents([.medium])
        }
    }

    private func textSheet(isPassword: Bool) -> some View {
        ScreenTextEntrySheet(
            isPassword: isPassword,
            onSend: { text, submit in
                if isPassword { showingPasswordSheet = false } else { showingTextSheet = false }
                model.typeText(text)
                if submit { model.sendShortcut(.return) }
            },
            onCancel: {
                if isPassword { showingPasswordSheet = false } else { showingTextSheet = false }
            }
        )
        .presentationDetents([.medium])
    }

    private func connectOnAppear() {
        if let machine {
            model.connect(using: machine)
        } else {
            model.markMachineUnavailable()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .connecting, .live, .authRequired:
            ScreenCanvasView(model: model)
        case .disabled(let detail):
            ScreenDisabledView(
                machineName: machine?.name ?? "your Mac",
                detail: detail,
                onRetry: { model.retry() }
            )
        case .closed(let reason):
            ContentUnavailableView {
                Label("Screen Disconnected", systemImage: "display")
            } description: {
                Text(reason)
            } actions: {
                if machine != nil {
                    Button("Reconnect") { model.retry() }
                        .buttonStyle(.borderedProminent)
                }
            }
        }
    }

    private var authPresented: Binding<Bool> {
        Binding(
            get: {
                if case .authRequired = model.phase { return true }
                return false
            },
            set: { presented in
                if !presented, case .authRequired = model.phase {
                    dismiss()
                }
            }
        )
    }
}
