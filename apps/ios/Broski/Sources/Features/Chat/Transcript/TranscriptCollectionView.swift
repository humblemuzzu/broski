import UIKit

/// The transcript's scroll view. Zeroes `safeAreaInsets` so `UIHostingConfiguration` cells never
/// shift downward or inflate their heights when scrolling under the navigation bar or composer;
/// the controller manages bar clearance exclusively via `contentInset`.
final class TranscriptCollectionView: UICollectionView {
    struct Anchor: Equatable {
        let id: String
        let screenY: CGFloat
    }

    override var safeAreaInsets: UIEdgeInsets { .zero }

    var isFollowing = true
    var itemID: (IndexPath) -> String? = { _ in nil }
    var indexPathForID: (String) -> IndexPath? = { _ in nil }
    /// Fired when position restoration shifts `contentOffset.y`, so drag tracking stays exact.
    var onOffsetAdjusted: ((CGFloat) -> Void)?
    /// The sent user prompt currently anchored to the top of the viewport while its reply streams.
    private(set) var anchoredPromptID: String?
    private(set) var isAnimatingToEnd = false
    private var inLayoutPass = false

    override func setContentOffset(_ contentOffset: CGPoint, animated: Bool) {
        // UIKit's `_updateVisibleCellsNow:` can call `setContentOffset(..., animated: true)` inside
        // `layoutSubviews()`, launching a rogue `UIScrollViewScrollAnimation`. Assigning
        // `contentOffset` directly avoids both that animation and killing active fling momentum.
        if animated && inLayoutPass {
            self.contentOffset = contentOffset
            return
        }
        super.setContentOffset(contentOffset, animated: animated)
    }

    override init(frame: CGRect, collectionViewLayout layout: UICollectionViewLayout) {
        super.init(frame: frame, collectionViewLayout: layout)
        insetsLayoutMarginsFromSafeArea = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    var transcriptLayout: TranscriptLayout? { collectionViewLayout as? TranscriptLayout }

    var holdsEnd: Bool { isFollowing && !isTracking && !isDecelerating && !isAnimatingToEnd }

    var minOffset: CGFloat { -adjustedContentInset.top }

    var visibleHeight: CGFloat {
        max(0, bounds.height - adjustedContentInset.top - adjustedContentInset.bottom)
    }

    var endOffset: CGFloat {
        max(minOffset, contentSize.height + adjustedContentInset.bottom - bounds.height)
    }

    var naturalEndOffset: CGFloat {
        let height = transcriptLayout?.contentHeight ?? contentSize.height
        return max(minOffset, height + adjustedContentInset.bottom - bounds.height)
    }

    var distanceFromEnd: CGFloat { max(0, endOffset - contentOffset.y) }

    var overflows: Bool {
        (transcriptLayout?.contentHeight ?? contentSize.height) > visibleHeight + 1
    }

    override func layoutSubviews() {
        inLayoutPass = true
        defer { inLayoutPass = false }
        let anchors = holdsEnd || isAnimatingToEnd ? [] : visibleAnchors()
        transcriptLayout?.applyReportedHeights()
        super.layoutSubviews()
        for _ in 0..<4 where measureNewCells() {
            super.layoutSubviews()
        }
        if updateTailSpacer() {
            super.layoutSubviews()
        }
        if holdsEnd {
            holdEnd()
        } else {
            restore(anchors)
        }
    }

    private func measureNewCells() -> Bool {
        guard let layout = transcriptLayout else { return false }
        let fitting = CGSize(width: bounds.width, height: CGFloat.greatestFiniteMagnitude)
        var measured: [(id: String, path: IndexPath, height: CGFloat)] = []
        for cell in visibleCells {
            guard let path = indexPath(for: cell), let id = itemID(path), layout.needsMeasure(id) else { continue }
            let height = ceil(cell.contentView.sizeThatFits(fitting).height)
            measured.append((id, path, height))
        }
        guard !measured.isEmpty else { return false }
        return layout.applyMeasured(measured)
    }

    /// Keeps `tailSpacer` sized so the anchored sent prompt rests at the top of the viewport while
    /// the reply fills the open canvas below it, then collapses to 0 seamlessly once full.
    private func updateTailSpacer() -> Bool {
        guard let layout = transcriptLayout, let id = anchoredPromptID else { return false }
        guard let path = indexPathForID(id), let frame = layout.layoutAttributesForItem(at: path)?.frame else {
            anchoredPromptID = nil
            return layout.setTailSpacer(0)
        }
        let turnHeight = max(0, layout.contentHeight - frame.minY)
        let desired = max(0, visibleHeight - turnHeight)
        if desired <= 0.5 {
            anchoredPromptID = nil
            return layout.setTailSpacer(0)
        }
        return layout.setTailSpacer(desired)
    }

    func anchorPromptToTop(_ id: String, animated: Bool) {
        anchoredPromptID = id
        isFollowing = true
        // Suppress `holdEnd()` during the measurement pass so `scrollToEnd` can glide smoothly.
        isAnimatingToEnd = animated
        setNeedsLayout()
        layoutIfNeeded()
        isAnimatingToEnd = false
        scrollToEnd(animated: animated)
    }

    func releasePromptAnchor() {
        anchoredPromptID = nil
    }

    /// Drops any leftover tail spacer once the reader is scrolled above the natural end so nothing
    /// jumps under their finger.
    func trimTailSpacerIfSafe() {
        guard anchoredPromptID == nil, let layout = transcriptLayout, layout.tailSpacer > 0 else { return }
        if contentOffset.y <= naturalEndOffset + 1 {
            if layout.setTailSpacer(0) { setNeedsLayout() }
        }
    }

    func preservingPosition(_ update: () -> Void) {
        let anchors = holdsEnd || isAnimatingToEnd ? [] : visibleAnchors()
        update()
        layoutIfNeeded()
        if !holdsEnd && !isAnimatingToEnd {
            restore(anchors)
        }
    }

    func scrollToEnd(animated: Bool) {
        if anchoredPromptID == nil { _ = transcriptLayout?.setTailSpacer(0) }
        layoutIfNeeded()
        let target = endOffset
        let distance = abs(target - contentOffset.y)
        guard distance > 0.5 else { return }
        if animated && distance < bounds.height * 3 {
            isAnimatingToEnd = true
            setContentOffset(CGPoint(x: contentOffset.x, y: target), animated: true)
        } else {
            super.setContentOffset(CGPoint(x: contentOffset.x, y: target), animated: false)
        }
    }

    func endAnimatingToEnd() {
        guard isAnimatingToEnd else { return }
        isAnimatingToEnd = false
        setNeedsLayout()
    }

    private func holdEnd() {
        let target = endOffset
        if abs(contentOffset.y - target) > 0.5 { contentOffset.y = target }
    }

    func visibleAnchors() -> [Anchor] {
        let top = contentOffset.y + adjustedContentInset.top
        let shown = CGRect(x: 0, y: top, width: bounds.width, height: max(1, visibleHeight))
        var starting: [(id: String, minY: CGFloat)] = []
        var cut: [(id: String, minY: CGFloat)] = []
        for item in collectionViewLayout.layoutAttributesForElements(in: shown) ?? [] {
            guard let id = itemID(item.indexPath) else { continue }
            let frame = item.frame
            if frame.minY >= top {
                starting.append((id, frame.minY))
            } else if frame.maxY > top {
                cut.append((id, frame.minY))
            }
        }
        return (starting.sorted { $0.minY < $1.minY } + cut).map { Anchor(id: $0.id, screenY: $0.minY - contentOffset.y) }
    }

    private func restore(_ anchors: [Anchor]) {
        for anchor in anchors {
            guard let path = indexPathForID(anchor.id) else { continue }
            restore(anchor, at: path)
            return
        }
    }

    private func restore(_ anchor: Anchor, at path: IndexPath) {
        guard let attributes = collectionViewLayout.layoutAttributesForItem(at: path) else { return }
        let target = attributes.frame.minY - anchor.screenY
        let previous = contentOffset.y
        guard abs(previous - target) > 0.5 else { return }
        let clamped = min(max(target, minOffset), max(endOffset, previous))
        guard abs(clamped - previous) > 0.5 else { return }
        // Direct property write preserves active UIScrollView deceleration momentum (unlike `setContentOffset`).
        contentOffset.y = clamped
        onOffsetAdjusted?(clamped - previous)
    }
}
