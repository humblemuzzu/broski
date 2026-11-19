import BroskiCore
import SwiftUI
import ThinkingOrbsKit

/// What an empty inbox says: nothing working under the working filter, the machines still on their
/// way, every machine unreachable, or simply no sessions yet.
struct InboxEmptyState: View {
    let filter: InboxState?
    let machines: [MachineModel]
    let showAll: () -> Void
    let startSession: () -> Void

    var body: some View {
        if filter != nil {
            ContentUnavailableView {
                Label("Nothing is working right now", systemImage: "checkmark.circle")
            } actions: {
                Button("Show All", action: showAll)
            }
        } else if let settling = machines.first(where: { $0.summary.health == .settling }),
            !machines.contains(where: { $0.summary.isReady })
        {
            ContentUnavailableView {
                Label {
                    Text("Connecting to \(settling.name)…")
                } icon: {
                    Orb(.connecting, side: 64)
                }
            } description: {
                Text(settling.summary.line)
            }
        } else if let unreachable = machines.first, !machines.contains(where: { $0.summary.isReady }) {
            ContentUnavailableView {
                Label(unreachable.summary.line, systemImage: "laptopcomputer.trianglebadge.exclamationmark")
            } description: {
                Text("Sessions show up here once \(unreachable.name) is back.")
            }
        } else {
            ContentUnavailableView {
                Label("No sessions yet", systemImage: "tray")
            } description: {
                Text("Sessions you start with Claude Code or Pi on your Mac show up here.")
            } actions: {
                Button("New Session", systemImage: "square.and.pencil", action: startSession)
                    .primaryActionStyle()
            }
        }
    }
}
