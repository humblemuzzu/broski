import BroskiCore
import SwiftUI
import ThinkingOrbsKit

/// One paired Mac: how it is connected or why it is not, when the relay last saw it, its bridge
/// and agents, and what can be done about it.
struct MachineSection: View {
    let machine: MachineModel
    @Environment(AppModel.self) private var model
    @State private var confirmingForget = false
    @State private var restartFailure: String?

    private var summary: MachineSummary { machine.summary }

    var body: some View {
        Section {
            Label {
                Text(summary.line)
            } icon: {
                if let statusSymbol {
                    Image(systemName: statusSymbol)
                        .foregroundStyle(statusTint)
                } else {
                    Orb(.connecting)
                }
            }
            if !summary.isReady, let lastSeen = machine.lastSeen {
                LabeledContent("Last seen") { RelativeTime(date: lastSeen) }
            }
            if let version = machine.bridgeVersion {
                LabeledContent("Bridge", value: version)
            }
            ForEach(machine.backends, id: \.id) { backend in
                LabeledContent(backend.id.displayName, value: agentStatus(backend.id))
            }
            if summary.canRestartBridge {
                Button("Restart Bridge", systemImage: "arrow.clockwise") {
                    do {
                        try machine.restartBridge()
                    } catch {
                        restartFailure = String(describing: error)
                    }
                }
            }
            Button("Forget \(machine.name)…", role: .destructive) { confirmingForget = true }
        } header: {
            Text(machine.name)
        } footer: {
            Text("Paired \(machine.pairedAt, format: .dateTime.day().month().year())")
        }
        .confirmationDialog(
            "Forget \(machine.name)?", isPresented: $confirmingForget, titleVisibility: .visible
        ) {
            Button("Forget", role: .destructive) { model.forget(machine) }
        } message: {
            Text("This phone will stop controlling \(machine.name).")
        }
        .alert(
            "The bridge didn't restart",
            isPresented: Binding(get: { restartFailure != nil }, set: { if !$0 { restartFailure = nil } }),
            presenting: restartFailure
        ) { _ in
            Button("OK") {}
        } message: { detail in
            Text("Try again once \(machine.name) is connected. (\(detail))")
        }
        .haptic(.failed, trigger: restartFailure, when: { $0 == nil && $1 != nil })
    }

    /// `nil` while settling, which shows the connecting orb.
    private var statusSymbol: String? {
        switch summary.health {
        case .ready: machine.status.link.route == .lan ? "wifi" : "globe"
        case .settling: nil
        case .attention: "exclamationmark.triangle.fill"
        case .revoked: "xmark.octagon.fill"
        }
    }

    private var statusTint: Color {
        switch summary.health {
        case .ready: Palette.done
        case .settling: Palette.working
        case .attention: Palette.caution
        case .revoked: Palette.failed
        }
    }

    private func agentStatus(_ backend: BackendId) -> String {
        guard let status = machine.backendStatuses[backend] else { return "Checking…" }
        if !status.installed { return "Not installed" }
        if !status.usable { return status.issues.first?.message ?? "Can't be used" }
        if status.auth == .signedOut { return "Signed out" }
        return status.version ?? "Installed"
    }
}
