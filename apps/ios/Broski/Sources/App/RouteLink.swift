import SwiftUI

/// A link to a `Route`: a `NavigationLink` on a SwiftUI stack, and a button that pushes through
/// `routeOpener` where one is set. A transcript row is drawn in a hosting cell, outside the
/// stack's view tree, where a `NavigationLink` would do nothing.
struct RouteLink<Label: View>: View {
    let route: Route
    @ViewBuilder let label: () -> Label
    @Environment(\.routeOpener) private var opener

    init(value route: Route, @ViewBuilder label: @escaping () -> Label) {
        self.route = route
        self.label = label
    }

    var body: some View {
        if let opener {
            Button { opener(route) } label: { label() }
        } else {
            NavigationLink(value: route) { label() }
        }
    }
}

extension EnvironmentValues {
    /// Set where links are drawn outside the stack they push on.
    @Entry var routeOpener: OpenRouteAction?
}
