import SwiftUI

/// Spacing on a 4-point grid, and the corner radii content uses. Controls take their shapes from
/// the system (capsules, concentric corners) rather than from here.
enum Spacing {
    static let xxs: CGFloat = 2
    static let xs: CGFloat = 4
    static let s: CGFloat = 8
    static let m: CGFloat = 12
    static let l: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
    static let xxxl: CGFloat = 48
}

enum Radius {
    static let small: CGFloat = 8
    static let card: CGFloat = 20
    static let sheetCard: CGFloat = 28
}
