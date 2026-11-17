import SwiftUI

/// The Live Activity's colours. It always sits on Broski's navy (the icon's) on the Lock Screen
/// and on the Dynamic Island's black, so its colours are the app's dark ones in either appearance.
enum ActivityStyle {
    static let background = Color(red: 0.075, green: 0.082, blue: 0.133)
    static let accent = Color(red: 0.545, green: 0.561, blue: 0.961)
    static let primary = Color.white
    static let secondary = Color.white.opacity(0.62)
    static let tertiary = Color.white.opacity(0.42)
}

extension RunState.Phase {
    var tint: Color {
        switch self {
        case .working: Color(red: 0.392, green: 0.824, blue: 1)
        case .needsYou: ActivityStyle.accent
        case .done: Color(red: 0.188, green: 0.820, blue: 0.345)
        }
    }
}
