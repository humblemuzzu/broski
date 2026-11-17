import SwiftUI
import UIKit

/// The mic's touches, from UIKit. The touch itself goes to `press`: the composer is rebuilt under
/// the finger when a recording starts, and neither a SwiftUI gesture nor this view then reliably
/// hears the finger lift, so `Dictation` also watches the touch's own phase.
struct MicTouchArea: UIViewRepresentable {
    let enabled: Bool
    let press: (UITouch) -> Void
    let slide: (_ distance: CGFloat) -> Void
    let release: (_ held: TimeInterval) -> Void

    func makeUIView(context: Context) -> TouchView {
        let view = TouchView()
        view.backgroundColor = .clear
        view.isMultipleTouchEnabled = false
        return view
    }

    func updateUIView(_ view: TouchView, context: Context) {
        view.isUserInteractionEnabled = enabled
        view.press = press
        view.slide = slide
        view.release = release
    }

    final class TouchView: UIView {
        var press: (UITouch) -> Void = { _ in }
        var slide: (CGFloat) -> Void = { _ in }
        var release: (TimeInterval) -> Void = { _ in }
        private var start: (point: CGPoint, time: TimeInterval)?

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard start == nil, let touch = touches.first else { return }
            start = (touch.location(in: self), touch.timestamp)
            press(touch)
        }

        override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard let start, let touch = touches.first else { return }
            slide(start.point.x - touch.location(in: self).x)
        }

        override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
            end(touches.first?.timestamp)
        }

        override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
            end(touches.first?.timestamp)
        }

        private func end(_ time: TimeInterval?) {
            guard let start else { return }
            self.start = nil
            release((time ?? ProcessInfo.processInfo.systemUptime) - start.time)
        }
    }
}
