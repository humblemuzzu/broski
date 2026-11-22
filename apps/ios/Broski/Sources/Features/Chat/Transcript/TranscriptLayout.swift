import UIKit

final class TranscriptCellView: UICollectionViewCell {
    override var safeAreaInsets: UIEdgeInsets { .zero }

    override init(frame: CGRect) {
        super.init(frame: frame)
        insetsLayoutMarginsFromSafeArea = false
        contentView.insetsLayoutMarginsFromSafeArea = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func preferredLayoutAttributesFitting(
        _ layoutAttributes: UICollectionViewLayoutAttributes
    ) -> UICollectionViewLayoutAttributes {
        layoutAttributes
    }
}

/// One-column transcript layout with per-id cached heights, warm re-measurement (changing rows keep
/// their prior height until measured rather than snapping to a guess), atomic `contentSizeAdjustment`
/// invalidation, and a dynamic `tailSpacer` so a sent prompt can anchor at the top of the viewport.
final class TranscriptLayout: UICollectionViewLayout {
    var itemID: (IndexPath) -> String? = { _ in nil }
    var indexPathForID: (String) -> IndexPath? = { _ in nil }
    var estimate: (IndexPath) -> CGFloat = { _ in 80 }

    private var heights: [String: CGFloat] = [:]
    private var dirtyHeights: Set<String> = []
    private var reported: [String: CGFloat] = [:]
    private var measuredWidth: CGFloat = 0
    private var attributes: [UICollectionViewLayoutAttributes] = []
    private(set) var contentHeight: CGFloat = 0
    private(set) var tailSpacer: CGFloat = 0
    private var firstDirty: Int?
    private var needsAll = true

    override var collectionViewContentSize: CGSize {
        CGSize(width: collectionView?.bounds.width ?? 0, height: contentHeight + tailSpacer)
    }

    override func prepare() {
        super.prepare()
        layOutFrames()
    }

    func needsMeasure(_ id: String) -> Bool {
        heights[id] == nil || dirtyHeights.contains(id)
    }

    func applyMeasured(_ changes: [(id: String, path: IndexPath, height: CGFloat)]) -> Bool {
        var paths: [IndexPath] = []
        var totalDelta: CGFloat = 0
        for (id, path, height) in changes {
            heights[id] = height
            dirtyHeights.remove(id)
            guard attributes.indices.contains(path.item) else { continue }
            let delta = height - attributes[path.item].frame.height
            guard abs(delta) > 0.5 else { continue }
            paths.append(path)
            totalDelta += delta
        }
        guard !paths.isEmpty else { return false }
        invalidate(from: paths, heightDelta: totalDelta)
        return true
    }

    func report(height: CGFloat, for id: String) {
        reported[id] = height
    }

    func applyReportedHeights() {
        guard !reported.isEmpty else { return }
        let changes = reported
        reported = [:]
        var paths: [IndexPath] = []
        var totalDelta: CGFloat = 0
        for (id, height) in changes {
            guard let path = indexPathForID(id), attributes.indices.contains(path.item) else { continue }
            let delta = height - attributes[path.item].frame.height
            heights[id] = height
            dirtyHeights.remove(id)
            guard abs(delta) > 0.5 else { continue }
            paths.append(path)
            totalDelta += delta
        }
        if !paths.isEmpty { invalidate(from: paths, heightDelta: totalDelta) }
    }

    /// Marks rows for re-measurement while keeping their last measured height until the updated
    /// cell measures, so streaming rows never snap back to a rough estimate.
    func markNeedsMeasure(_ ids: [String]) {
        for id in ids { dirtyHeights.insert(id) }
    }

    /// Adjusts the trailing empty canvas height used while a sent prompt is anchored at the top.
    @discardableResult
    func setTailSpacer(_ spacer: CGFloat) -> Bool {
        let clamped = max(0, ceil(spacer))
        let delta = clamped - tailSpacer
        guard abs(delta) > 0.5 else { return false }
        tailSpacer = clamped
        let context = UICollectionViewLayoutInvalidationContext()
        context.contentSizeAdjustment = CGSize(width: 0, height: delta)
        invalidateLayout(with: context)
        return true
    }

    private func invalidate(from changed: [IndexPath], heightDelta: CGFloat) {
        guard let first = changed.map(\.item).min(), let view = collectionView else { return }
        let shrinkSlack = max(0, -heightDelta)
        let near = view.bounds.insetBy(dx: 0, dy: -(view.bounds.height + shrinkSlack))
        let moved = indices(in: near).filter { $0 > first }.map { IndexPath(item: $0, section: 0) }
        let visible = view.indexPathsForVisibleItems.filter { $0.item > first }
        let context = UICollectionViewLayoutInvalidationContext()
        context.contentSizeAdjustment = CGSize(width: 0, height: heightDelta)
        context.invalidateItems(at: Array(Set(changed + moved + visible)))
        invalidateLayout(with: context)
    }

    override func layoutAttributesForElements(in rect: CGRect) -> [UICollectionViewLayoutAttributes]? {
        indices(in: rect).map { attributes[$0] }
    }

    override func layoutAttributesForItem(at indexPath: IndexPath) -> UICollectionViewLayoutAttributes? {
        attributes.indices.contains(indexPath.item) ? attributes[indexPath.item] : nil
    }

    override func shouldInvalidateLayout(forBoundsChange newBounds: CGRect) -> Bool {
        newBounds.width != measuredWidth
    }

    override func invalidateLayout(with context: UICollectionViewLayoutInvalidationContext) {
        if context.invalidateEverything || context.invalidateDataSourceCounts {
            needsAll = true
        } else if let paths = context.invalidatedItemIndexPaths, let lowest = paths.map(\.item).min() {
            firstDirty = min(firstDirty ?? lowest, lowest)
        }
        super.invalidateLayout(with: context)
    }

    private func layOutFrames() {
        guard let view = collectionView else { return }
        let width = view.bounds.width
        if width != measuredWidth {
            measuredWidth = width
            heights.removeAll()
            dirtyHeights.removeAll()
            needsAll = true
        }
        let count = view.numberOfSections > 0 ? view.numberOfItems(inSection: 0) : 0
        let start: Int
        if needsAll || attributes.count != count {
            attributes = (0..<count).map { UICollectionViewLayoutAttributes(forCellWith: IndexPath(item: $0, section: 0)) }
            start = 0
        } else if let firstDirty {
            start = min(firstDirty, count)
        } else {
            return
        }
        var y = start > 0 ? attributes[start - 1].frame.maxY : 0
        for index in start..<count {
            let path = IndexPath(item: index, section: 0)
            let height = itemID(path).flatMap { heights[$0] } ?? estimate(path)
            let frame = CGRect(x: 0, y: y, width: width, height: height)
            // UIKit compares attributes by value against what it last applied; mutating in place
            // leaves existing cells at their previous frames.
            if attributes[index].frame != frame {
                let moved = UICollectionViewLayoutAttributes(forCellWith: path)
                moved.frame = frame
                attributes[index] = moved
            }
            y += height
        }
        contentHeight = y
        needsAll = false
        firstDirty = nil
    }

    private func indices(in rect: CGRect) -> Range<Int> {
        var low = 0
        var high = attributes.count
        while low < high {
            let mid = (low + high) / 2
            if attributes[mid].frame.maxY < rect.minY { low = mid + 1 } else { high = mid }
        }
        var end = low
        while end < attributes.count, attributes[end].frame.minY <= rect.maxY { end += 1 }
        return low..<end
    }
}
