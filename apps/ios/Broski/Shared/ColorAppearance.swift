import SwiftUI
import UIKit

extension Color {
    /// A color for each appearance, from `0xRRGGBB`. Nonisolated: SwiftUI resolves a dynamic color
    /// on its render thread too, where a provider isolated to the main actor traps.
    nonisolated init(light: UInt32, dark: UInt32) {
        self.init(light: Self.rgb(light), dark: Self.rgb(dark))
    }

    nonisolated init(light: UIColor, dark: UIColor) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }

    private nonisolated static func rgb(_ value: UInt32) -> UIColor {
        UIColor(
            red: CGFloat(value >> 16 & 0xFF) / 255, green: CGFloat(value >> 8 & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255, alpha: 1)
    }
}
