import BroskiCore
import QuartzCore
import UIKit

/// Smooths bursty streaming deltas from the bridge into a steady 60 Hz display-synced text reveal.
/// Runs its `CADisplayLink` only while `displayed != target`, so idle chats cost zero CPU/battery.
final class StreamingPacer {
    var onTick: () -> Void = {}

    private var targets: [String: String] = [:]
    private var displayedBytes: [String: Int] = [:]
    private var link: CADisplayLink?

    /// Updates targets from the latest snapshot's open blocks and returns blocks with paced text.
    /// Non-animated syncs (initial attach, reconnect reset, Reduce Motion) snap immediately.
    func sync(_ blocks: [OpenBlock], animated: Bool) -> [OpenBlock] {
        let activeIDs = Set(blocks.map(\.blockId))
        targets = targets.filter { activeIDs.contains($0.key) }
        displayedBytes = displayedBytes.filter { activeIDs.contains($0.key) }

        let pace = animated && !UIAccessibility.isReduceMotionEnabled
        var result: [OpenBlock] = []
        result.reserveCapacity(blocks.count)

        for var block in blocks {
            let id = block.blockId
            let target = block.text
            let targetBytes = target.utf8.count
            let previousTarget = targets[id]
            targets[id] = target

            if !pace {
                displayedBytes[id] = targetBytes
            } else if let prev = previousTarget, let shownBytes = displayedBytes[id],
                targetBytes >= shownBytes,
                (target == prev || target.hasPrefix(prev))
            {
                // Keep advancing smoothly from the already-revealed UTF-8 byte offset.
            } else if previousTarget == nil {
                displayedBytes[id] = targetBytes <= 8 ? targetBytes : advanceBytes(from: 0, in: target)
            } else {
                // Non-prefix edit or reset: snap so we never slice an invalid index.
                displayedBytes[id] = targetBytes
            }

            let shownBytes = displayedBytes[id] ?? targetBytes
            block.text = shownBytes >= targetBytes ? target : slice(target, utf8Bytes: shownBytes)
            result.append(block)
        }

        updateLink()
        return result
    }

    /// Snaps all in-flight text to its final target and stops the display link.
    func flush() {
        for (id, target) in targets { displayedBytes[id] = target.utf8.count }
        stop()
    }

    /// Clears all state and stops the display link (call when switching or leaving a session).
    func reset() {
        targets.removeAll()
        displayedBytes.removeAll()
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
            let targetBytes = target.utf8.count
            guard let shownBytes = displayedBytes[id], shownBytes < targetBytes else { continue }
            let next = advanceBytes(from: shownBytes, in: target)
            if next != shownBytes {
                displayedBytes[id] = next
                changed = true
            }
            if next < targetBytes { stillPending = true }
        }

        if !stillPending { stop() }
        if changed { onTick() }
    }

    private func advanceBytes(from shownBytes: Int, in target: String) -> Int {
        let targetBytes = target.utf8.count
        let backlogBytes = targetBytes - shownBytes
        guard backlogBytes > 0 else { return targetBytes }

        let baseStep = max(2, Int(ceil(Double(backlogBytes) / 5.0)))
        guard baseStep < backlogBytes else { return targetBytes }

        let utf8 = target.utf8
        let start = utf8.index(utf8.startIndex, offsetBy: shownBytes)
        var cut = target.index(start, offsetBy: baseStep, limitedBy: target.endIndex) ?? target.endIndex
        if cut >= target.endIndex { return targetBytes }
        // When catching up on longer bursts, snap slightly forward to the next word boundary so
        // whole words appear cleanly rather than flickering mid-word.
        if backlogBytes > 12 {
            var lookahead = cut
            for _ in 0..<4 where lookahead < target.endIndex {
                if target[lookahead].isWhitespace {
                    cut = target.index(after: lookahead)
                    break
                }
                lookahead = target.index(after: lookahead)
            }
        }
        return utf8.distance(from: utf8.startIndex, to: cut)
    }

    private func slice(_ target: String, utf8Bytes: Int) -> String {
        let utf8 = target.utf8
        let end = utf8.index(utf8.startIndex, offsetBy: min(utf8Bytes, utf8.count))
        return String(target[..<end])
    }

    private func updateLink() {
        let hasPending = targets.contains { (displayedBytes[$0.key] ?? 0) < $0.value.utf8.count }
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
