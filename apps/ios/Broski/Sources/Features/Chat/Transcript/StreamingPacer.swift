import BroskiCore
import QuartzCore
import UIKit

/// Smooths bursty streaming deltas from the bridge into a steady 60 Hz display-synced text reveal.
/// Runs its `CADisplayLink` only while `displayed != target`, so idle chats cost zero CPU/battery.
final class StreamingPacer {
    var onTick: () -> Void = {}

    private var targets: [String: String] = [:]
    private var displayed: [String: String] = [:]
    private var link: CADisplayLink?

    /// Updates targets from the latest snapshot's open blocks and returns blocks with paced text.
    /// Non-animated syncs (initial attach, reconnect reset, Reduce Motion) snap immediately.
    func sync(_ blocks: [OpenBlock], animated: Bool) -> [OpenBlock] {
        let activeIDs = Set(blocks.map(\.blockId))
        targets = targets.filter { activeIDs.contains($0.key) }
        displayed = displayed.filter { activeIDs.contains($0.key) }

        let pace = animated && !UIAccessibility.isReduceMotionEnabled
        var result: [OpenBlock] = []
        result.reserveCapacity(blocks.count)

        for var block in blocks {
            let id = block.blockId
            let target = block.text
            let previousTarget = targets[id]
            targets[id] = target

            if !pace {
                displayed[id] = target
            } else if let shown = displayed[id], target.hasPrefix(shown) {
                // Keep advancing smoothly from the already-revealed prefix.
            } else if previousTarget == nil {
                displayed[id] = target.count <= 8 ? target : advance(from: "", toward: target)
            } else {
                // Non-prefix edit or reset: snap so we never slice an invalid index.
                displayed[id] = target
            }

            block.text = displayed[id] ?? target
            result.append(block)
        }

        updateLink()
        return result
    }

    /// Snaps all in-flight text to its final target and stops the display link.
    func flush() {
        for (id, target) in targets { displayed[id] = target }
        stop()
    }

    /// Clears all state and stops the display link (call when switching or leaving a session).
    func reset() {
        targets.removeAll()
        displayed.removeAll()
        stop()
    }

    func stop() {
        link?.invalidate()
        link = nil
    }

    fileprivate func tick() {
        var changed = false
        var stillPending = false

        for (id, target) in targets {
            guard let shown = displayed[id], shown != target else { continue }
            guard target.hasPrefix(shown) else {
                displayed[id] = target
                changed = true
                continue
            }
            let next = advance(from: shown, toward: target)
            if next != shown {
                displayed[id] = next
                changed = true
            }
            if next != target { stillPending = true }
        }

        if !stillPending { stop() }
        if changed { onTick() }
    }

    private func advance(from shown: String, toward target: String) -> String {
        let start = shown.endIndex
        let remaining = target[start...]
        let backlog = remaining.count
        guard backlog > 0 else { return target }

        let baseStep = max(2, Int(ceil(Double(backlog) / 5.0)))
        guard baseStep < backlog else { return target }

        var cut = target.index(start, offsetBy: baseStep)
        // When catching up on longer bursts, snap slightly forward to the next word boundary so
        // whole words appear cleanly rather than flickering mid-word.
        if backlog > 12 {
            var lookahead = cut
            for _ in 0..<4 where lookahead < target.endIndex {
                if target[lookahead].isWhitespace {
                    cut = target.index(after: lookahead)
                    break
                }
                lookahead = target.index(after: lookahead)
            }
        }
        return String(target[..<cut])
    }

    private func updateLink() {
        let hasPending = targets.contains { displayed[$0.key] != $0.value }
        if hasPending {
            guard link == nil else { return }
            let displayLink = CADisplayLink(target: DisplayLinkProxy(self), selector: #selector(DisplayLinkProxy.step(_:)))
            displayLink.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
            displayLink.add(to: .main, forMode: .common)
            link = displayLink
        } else {
            stop()
        }
    }
}

private final class DisplayLinkProxy: NSObject {
    private weak var owner: StreamingPacer?

    init(_ owner: StreamingPacer) {
        self.owner = owner
    }

    @objc func step(_ link: CADisplayLink) {
        MainActor.assumeIsolated {
            guard let owner else {
                link.invalidate()
                return
            }
            owner.tick()
        }
    }
}
