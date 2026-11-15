import SwiftUI

/// The type scale: system text styles only, so everything follows Dynamic Type. Commands, paths
/// and code are monospaced (SF Mono) at the same styles.
extension Font {
    static let screenTitle = Font.largeTitle.weight(.bold)
    static let rowTitle = Font.body.weight(.semibold)
    static let rowDetail = Font.subheadline
    static let code = Font.system(.callout, design: .monospaced)
    static let codeSmall = Font.system(.footnote, design: .monospaced)
}
