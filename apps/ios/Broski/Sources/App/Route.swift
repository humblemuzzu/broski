import BroskiCore
import SwiftUI

/// Every screen pushed onto the app's navigation stacks, and the view each one shows.
enum Route: Hashable {
    case machines
    case workspace(machineId: String, place: WorkspacePlace)
    case session(machineId: String, session: SessionRef)
    /// A session yet to be made; it becomes the session's chat once sent.
    case newSession
    /// A file a tool call changed, as its diff.
    case toolDiff(FileChange)
    /// A long text a row shows only a clip of.
    case text(TextPage)
}

struct RouteDestination: View {
    let route: Route

    var body: some View {
        switch route {
        case .machines:
            MachinesScreen()
        case .workspace(let machineId, let place):
            WorkspaceDestination(machineId: machineId, place: place)
        // A plain push: a zoom out of an inbox row froze mid-transition on a device when the row
        // changed under it, leaving the chat blank and Back dead.
        case .session(let machineId, let session):
            ChatScreen(target: SessionTarget(machineId: machineId, session: session))
        case .newSession:
            NewSessionScreen()
        case .toolDiff(let change):
            ToolDiffScreen(change: change)
        case .text(let page):
            TextPageScreen(page: page)
        }
    }
}

extension View {
    /// Registers `Route` on the enclosing navigation stack.
    func routeDestinations() -> some View {
        navigationDestination(for: Route.self) { RouteDestination(route: $0) }
    }
}
