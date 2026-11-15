import SwiftUI

/// The app's mark as the icon draws it: a prompt chevron and cursor on the accent, in a
/// continuous-corner tile of `side` points.
struct BroskiMark: View {
    let side: CGFloat

    var body: some View {
        Canvas { context, size in
            let unit = size.width / 1024
            var chevron = Path()
            chevron.move(to: CGPoint(x: 300 * unit, y: 324 * unit))
            chevron.addLine(to: CGPoint(x: 500 * unit, y: 512 * unit))
            chevron.addLine(to: CGPoint(x: 300 * unit, y: 700 * unit))
            context.stroke(
                chevron, with: .color(.white),
                style: StrokeStyle(lineWidth: 92 * unit, lineCap: .round, lineJoin: .round))
            let cursor = Path(
                roundedRect: CGRect(x: 560 * unit, y: 654 * unit, width: 200 * unit, height: 92 * unit),
                cornerRadius: 46 * unit)
            context.fill(cursor, with: .color(.white))
        }
        .frame(width: side, height: side)
        .background(Palette.accent.gradient, in: .rect(cornerRadius: side * 0.225, style: .continuous))
        .accessibilityHidden(true)
    }
}
