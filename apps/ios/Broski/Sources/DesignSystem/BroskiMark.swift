import SwiftUI

/// The app's icon in a continuous-corner tile of `side` points.
struct BroskiMark: View {
    let side: CGFloat

    var body: some View {
        Image("BroskiMark")
            .resizable()
            .interpolation(.high)
            .frame(width: side, height: side)
            .clipShape(.rect(cornerRadius: side * 0.225, style: .continuous))
            .accessibilityHidden(true)
    }
}
