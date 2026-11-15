import SwiftUI

/// Every screen pushed onto the app's navigation stacks, and the view each one shows.
enum Route: Hashable {
    case machines
}

struct RouteDestination: View {
    let route: Route

    var body: some View {
        switch route {
        case .machines:
            MachinesScreen()
        }
    }
}

extension View {
    /// Registers `Route` on the enclosing navigation stack.
    func routeDestinations() -> some View {
        navigationDestination(for: Route.self) { RouteDestination(route: $0) }
    }
}
