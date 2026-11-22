import SwiftUI

/// The Live Activity's colours. It sits on the system's own Lock Screen material, so text takes the
/// semantic colours; colour itself is kept for what needs the person (orange) and what is done
/// (green), while work in progress stays neutral.
extension RunState.Phase {
    var tint: Color {
        switch self {
        case .working: .secondary
        case .needsYou: .orange
        case .done: .green
        }
    }

    /// The Dynamic Island's rim, which sits on black.
    var keyline: Color {
        switch self {
        case .working: .white.opacity(0.35)
        case .needsYou: .orange
        case .done: .green
        }
    }
}

extension View {
    /// The Dynamic Island is always black: its views draw as in the dark appearance.
    func islandInk() -> some View {
        environment(\.colorScheme, .dark)
    }
}
