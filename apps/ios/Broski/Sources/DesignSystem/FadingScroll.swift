import SwiftUI

/// A horizontal scroll view whose trailing edge fades out while there is more to scroll to, so a cut
/// row reads as scrolling and not as the end of the row.
struct FadingHorizontalScroll<Content: View>: View {
    @ViewBuilder let content: Content
    @State private var moreToCome = false

    var body: some View {
        ScrollView(.horizontal) { content }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentOffset.x + geometry.containerSize.width < geometry.contentSize.width - 1
            } action: { _, more in
                moreToCome = more
            }
            .mask {
                HStack(spacing: 0) {
                    Rectangle()
                    if moreToCome {
                        LinearGradient(colors: [.black, .clear], startPoint: .leading, endPoint: .trailing).frame(width: 24)
                    }
                }
            }
    }
}
