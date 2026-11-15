import BroskiCore
import SwiftUI

/// Every screen pushed onto the app's navigation stacks, and the view each one shows.
enum Route: Hashable {
    case machines
    case workspace(machineId: String, place: WorkspacePlace)
    case session(machineId: String, session: SessionRef)
    /// A file a tool call changed, as its diff.
    case toolDiff(FileChange)
}

struct RouteDestination: View {
    let route: Route
    @Environment(\.zoomNamespace) private var zoom

    var body: some View {
        switch route {
        case .machines:
            MachinesScreen()
        case .workspace(let machineId, let place):
            WorkspaceDestination(machineId: machineId, place: place)
        case .session(let machineId, let session):
            let target = SessionTarget(machineId: machineId, session: session)
            if let zoom {
                ChatScreen(target: target).navigationTransition(.zoom(sourceID: target, in: zoom))
            } else {
                ChatScreen(target: target)
            }
        case .toolDiff(let change):
            ToolDiffScreen(change: change)
        }
    }
}

extension View {
    /// Registers `Route` on the enclosing navigation stack.
    func routeDestinations() -> some View {
        navigationDestination(for: Route.self) { RouteDestination(route: $0) }
    }
}

extension EnvironmentValues {
    /// The namespace a stack's session rows are zoom sources in; a chat opened on that stack zooms
    /// out of the row (or the button) that opened it.
    @Entry var zoomNamespace: Namespace.ID?
}
