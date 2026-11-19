import BroskiCore
import GhosttyTerminal
import SwiftUI

/// A real terminal on the machine: Ghostty's emulator fed by the terminal's bytes, with a row of
/// the keys a phone keyboard lacks. Pinch changes the font size, which the next terminal keeps.
struct TerminalScreen: View {
    @State private var model: TerminalModel
    @State private var title = ""
    @AppStorage(Preference.terminalFontSize) private var fontSize: Double = 0
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.workspaceReachable) private var reachable

    init(machine: Machine, start: TerminalModel.Start, requests: WorkspaceRequests) {
        let stored = UserDefaults.standard.double(forKey: Preference.terminalFontSize)
        _model = State(
            initialValue: TerminalModel(
                start: start, requests: requests, fontSize: stored > 0 ? Float(stored) : nil,
                attach: { try machine.terminal(id: $0) }))
    }

    var body: some View {
        TerminalSurfaceView(context: model.state)
            .accessibilityLabel("Terminal")
            .accessibilityIdentifier("terminal")
            .ignoresSafeArea(.container, edges: .bottom)
            .safeAreaInset(edge: .top, spacing: 0) { statusStrip }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                TerminalKeyBar(state: model.state)
                    .disabled(model.phase != .attached)
            }
            .navigationTitle(title.isEmpty ? "Terminal" : title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar(.hidden, for: .tabBar)
            .task(id: active) {
                if active { await model.show() } else { model.hide() }
            }
            .task(id: colorScheme) {
                model.applyColorScheme(colorScheme)
            }
            .onDisappear { model.hide() }
            .onReceive(model.state.$title) { title = $0 }
            .onReceive(model.state.$fontSize) { size in
                if let size { fontSize = Double(size) }
            }
    }

    /// Attached only while on screen, in front, and reachable; a backgrounded app keeps no pull.
    private var active: Bool { scenePhase == .active && reachable }

    @ViewBuilder
    private var statusStrip: some View {
        switch model.phase {
        case .opening:
            TerminalNote(text: "Opening…", symbol: "hourglass")
        case .attached:
            if let problem = model.problem {
                Banner(problem: problem).padding(Spacing.s)
            }
        case .detached, .ended(.detached):
            Banner(style: .info, message: "This terminal is open somewhere else.") {
                Button("Show It Here") { Task { await model.show() } }
            }
            .padding(Spacing.s)
        case .ended(.exited(let code, let signal)):
            TerminalNote(text: exitText(code: code, signal: signal), symbol: "stop.circle")
        case .ended(.failed(let message)):
            TerminalNote(text: message, symbol: "exclamationmark.triangle")
        case .failed(let problem):
            Banner(problem: problem).padding(Spacing.s)
        }
    }

    private func exitText(code: Int64?, signal: String?) -> String {
        if let signal { return "Ended by \(signal)" }
        if let code { return code == 0 ? "Exited" : "Exited with code \(code)" }
        return "Exited"
    }
}

private struct TerminalNote: View {
    let text: String
    let symbol: String

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.footnote.weight(.medium))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, Spacing.s)
            .background(.bar)
    }
}
