import SwiftUI
import UIKit

extension View {
    /// On a navigation stack's root: a light tap each time a swipe back, from the edge or across the
    /// content, is let go and the screen pops. A swipe that springs back plays nothing.
    func backSwipeHaptic() -> some View {
        modifier(BackSwipeHaptic())
    }
}

private struct BackSwipeHaptic: ViewModifier {
    @State private var pops = 0

    func body(content: Content) -> some View {
        content
            .background { PopWatcher { pops += 1 }.frame(width: 0, height: 0) }
            .haptic(.swipedBack, trigger: pops)
    }
}

/// Watches the enclosing navigation controller's pop gestures; `popped` runs when one ends in a pop.
private struct PopWatcher: UIViewControllerRepresentable {
    let popped: () -> Void

    func makeUIViewController(context: Context) -> Watcher {
        Watcher(popped: popped)
    }

    func updateUIViewController(_ watcher: Watcher, context: Context) {
        watcher.popped = popped
    }

    final class Watcher: UIViewController {
        var popped: () -> Void
        private weak var watched: UINavigationController?
        /// The coordinator of the pop this gesture began says how it ends.
        private var coordinated = false

        init(popped: @escaping () -> Void) {
            self.popped = popped
            super.init(nibName: nil, bundle: nil)
        }

        required init?(coder: NSCoder) { nil }

        override func didMove(toParent parent: UIViewController?) {
            super.didMove(toParent: parent)
            watch(navigationController)
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            watch(navigationController)
        }

        private func watch(_ navigation: UINavigationController?) {
            guard let navigation, navigation !== watched else { return }
            watched = navigation
            for gesture in [navigation.interactivePopGestureRecognizer, navigation.interactiveContentPopGestureRecognizer] {
                gesture?.addTarget(self, action: #selector(swiped(_:)))
            }
        }

        @objc private func swiped(_ gesture: UIGestureRecognizer) {
            let coordinator = watched?.transitionCoordinator
            switch gesture.state {
            case .began:
                guard let coordinator else { return }
                coordinated = true
                coordinator.notifyWhenInteractionChanges { [weak self] context in
                    if !context.isCancelled { self?.popped() }
                }
            case .ended:
                if !coordinated, let coordinator, !coordinator.isCancelled { popped() }
                coordinated = false
            case .cancelled, .failed:
                coordinated = false
            default:
                break
            }
        }
    }
}
