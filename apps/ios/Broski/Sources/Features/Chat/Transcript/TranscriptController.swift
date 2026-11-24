import SwiftUI
import UIKit

/// What kind of programmatic scroll the chat asked for: jumping back to the end, or anchoring a
/// newly sent prompt to the top of the viewport so the reply streams into open space below it.
struct TranscriptJump: Equatable {
    enum Kind: Equatable {
        case end
        case anchorPrompt(String)
    }

    let id: Int
    let kind: Kind
}

final class TranscriptController: UIViewController, UICollectionViewDelegate, UIGestureRecognizerDelegate {
    struct Callbacks {
        var updateFollow: (_ change: (inout FollowState) -> Void) -> FollowState = { _ in FollowState() }
        var nearTop: () -> Void = {}
        var dismissKeyboard: () -> Void = {}
    }

    var callbacks = Callbacks()
    var context: TranscriptCellContext?

    struct HistoryKey: Equatable {
        let revision: Int
        let collapsing: Bool
        let open: Set<String>
    }

    private let layout = TranscriptLayout()
    private(set) lazy var collectionView = TranscriptCollectionView(frame: .zero, collectionViewLayout: layout)
    private var dataSource: UICollectionViewDiffableDataSource<Int, String>!
    private var entries: [String: TranscriptEntry] = [:]
    private var order: [String] = []
    private var lastHistoryKey: HistoryKey?
    private var lastHistoryRange: Range<Int> = 0..<0
    private var readingCompact = UserDefaults.standard.bool(forKey: Preference.readingCompact)
    private var defaultsTask: Task<Void, Never>?
    /// Rows that have already animated their first appearance (never animated a second time).
    private var animatedIDs: Set<String> = []
    /// Live rows eligible to animate on first appearance, supplied by `ChatModel`.
    private var freshIDs: Set<String> = []
    private var handledJumpID: Int?
    private var dragStart: CGFloat = 0
    private var barInsets = EdgeInsets()
    private var keyboard: (duration: Double, curve: UInt, at: Date)?

    override func loadView() {
        view = collectionView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        configureCollectionView()
        let cells = UICollectionView.CellRegistration<TranscriptCellView, String> { [weak self] cell, _, id in
            cell.backgroundConfiguration = .clear()
            guard let self, let row = cellView(id) else { return }
            cell.contentConfiguration = UIHostingConfiguration { row.id(id) }
                .margins(.all, 0)
                .minSize(height: 0)
        }
        dataSource = UICollectionViewDiffableDataSource(collectionView: collectionView) { view, path, id in
            view.dequeueConfiguredReusableCell(using: cells, for: path, item: id)
        }
        collectionView.itemID = { [weak self] in self?.dataSource.itemIdentifier(for: $0) }
        collectionView.indexPathForID = { [weak self] in self?.dataSource.indexPath(for: $0) }
        collectionView.onOffsetAdjusted = { [weak self] delta in self?.dragStart += delta }
        layout.itemID = collectionView.itemID
        layout.indexPathForID = collectionView.indexPathForID
        layout.estimate = { [weak self] path in
            guard let self, let id = dataSource.itemIdentifier(for: path), let entry = entries[id] else { return 80 }
            return TranscriptEstimate.height(of: entry, width: contentWidth, compact: readingCompact)
        }
        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardWillChange(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        defaultsTask = Task { [weak self] in
            for await _ in NotificationCenter.default.notifications(named: UserDefaults.didChangeNotification) {
                guard let self else { return }
                let compact = UserDefaults.standard.bool(forKey: Preference.readingCompact)
                guard compact != self.readingCompact else { continue }
                self.readingCompact = compact
                self.layout.invalidateLayout()
            }
        }
    }

    deinit {
        defaultsTask?.cancel()
    }

    private var contentWidth: CGFloat { collectionView.bounds.width - 2 * TranscriptView.sideMargin }

    private func cellView(_ id: String) -> TranscriptCell? {
        guard let entry = entries[id], let context else { return nil }
        let isFresh = freshIDs.contains(id) && animatedIDs.insert(id).inserted && entry.risesIn
        let width = contentWidth
        return TranscriptCell(entry: entry, isFresh: isFresh, context: context, contentWidth: width > 0 ? width : nil) { [weak self] height in
            self?.layout.report(height: ceil(height), for: id)
            self?.collectionView.setNeedsLayout()
        }
    }

    private func configureCollectionView() {
        let view = collectionView
        view.backgroundColor = .clear
        view.accessibilityIdentifier = "transcript"
        view.contentInsetAdjustmentBehavior = .never
        view.alwaysBounceVertical = true
        view.showsHorizontalScrollIndicator = false
        view.keyboardDismissMode = .interactive
        view.selfSizingInvalidation = .disabled
        view.isPrefetchingEnabled = false
        view.topEdgeEffect.style = .soft
        view.bottomEdgeEffect.style = .soft
        view.delegate = self
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
        tap.cancelsTouchesInView = false
        tap.delegate = self
        view.addGestureRecognizer(tap)
    }

    // MARK: Updates

    func show(
        _ items: [(id: String, entry: TranscriptEntry)],
        freshIDs: Set<String> = [],
        historyRange: Range<Int>? = nil,
        historyKey: HistoryKey? = nil
    ) {
        self.freshIDs = freshIDs

        // Fast path: unchanged order and unchanged history slice (60 Hz streaming tick) — skip
        // rebuilding the full entries map and skip deep-comparing every historical row.
        if let historyRange, let historyKey,
            historyKey == lastHistoryKey,
            historyRange == lastHistoryRange,
            items.count == order.count,
            sameTailOrder(items, from: historyRange.upperBound)
        {
            var changed: [String] = []
            for index in 0..<historyRange.lowerBound {
                let (id, entry) = items[index]
                if entries[id] != entry {
                    entries[id] = entry
                    changed.append(id)
                }
            }
            for index in historyRange.upperBound..<items.count {
                let (id, entry) = items[index]
                if entries[id] != entry {
                    entries[id] = entry
                    changed.append(id)
                }
            }
            guard !changed.isEmpty else { return }
            layout.markNeedsMeasure(changed)
            updateChangedVisibleCells(changed)
            return
        }

        var ids: [String] = []
        var next: [String: TranscriptEntry] = [:]
        ids.reserveCapacity(items.count)
        next.reserveCapacity(items.count)
        for (id, entry) in items where next[id] == nil {
            ids.append(id)
            next[id] = entry
        }
        let changed = ids.filter { id in entries[id].map { $0 != next[id] } ?? false }
        entries = next
        lastHistoryKey = historyKey
        lastHistoryRange = historyRange ?? 0..<0
        guard ids != order || !changed.isEmpty else { return }
        layout.markNeedsMeasure(changed)

        // Fast path: order unchanged (typical 30–60 Hz streaming tick) — update visible cells in
        // place without diffing the entire snapshot.
        if ids == order {
            updateChangedVisibleCells(changed)
            return
        }

        var snapshot = NSDiffableDataSourceSnapshot<Int, String>()
        snapshot.appendSections([0])
        snapshot.appendItems(ids)
        order = ids
        if !changed.isEmpty { snapshot.reconfigureItems(changed) }
        collectionView.preservingPosition { dataSource.apply(snapshot, animatingDifferences: false) }
        checkNearTop()
    }

    private func sameTailOrder(_ items: [(id: String, entry: TranscriptEntry)], from tailStart: Int) -> Bool {
        for index in 0..<lastHistoryRange.lowerBound where items[index].id != order[index] {
            return false
        }
        for index in tailStart..<items.count where items[index].id != order[index] {
            return false
        }
        return true
    }

    private func updateChangedVisibleCells(_ changed: [String]) {
        collectionView.preservingPosition {
            for id in changed {
                guard let path = dataSource.indexPath(for: id),
                    let cell = collectionView.cellForItem(at: path) as? TranscriptCellView,
                    let row = cellView(id)
                else { continue }
                cell.contentConfiguration = UIHostingConfiguration { row.id(id) }
                    .margins(.all, 0)
                    .minSize(height: 0)
            }
            collectionView.setNeedsLayout()
        }
    }

    func setBarInsets(_ insets: EdgeInsets) {
        guard insets != barInsets else { return }
        barInsets = insets
        let view = collectionView
        let content = UIEdgeInsets(top: insets.top + Spacing.m, left: 0, bottom: insets.bottom + Spacing.m, right: 0)
        let change = {
            view.contentInset = content
            view.verticalScrollIndicatorInsets = UIEdgeInsets(top: insets.top, left: 0, bottom: insets.bottom, right: 0)
            view.layoutIfNeeded()
        }
        if let keyboard, keyboard.at.timeIntervalSinceNow > -0.6, view.window != nil {
            self.keyboard = nil
            UIView.animate(
                withDuration: keyboard.duration, delay: 0,
                options: [UIView.AnimationOptions(rawValue: keyboard.curve << 16), .beginFromCurrentState, .allowUserInteraction],
                animations: { view.preservingPosition(change) })
        } else {
            view.preservingPosition(change)
        }
    }

    func setFollowing(_ following: Bool) {
        guard collectionView.isFollowing != following else { return }
        collectionView.isFollowing = following
        collectionView.setNeedsLayout()
    }

    func jump(_ request: TranscriptJump?) {
        guard let request else { return }
        defer { handledJumpID = request.id }
        guard handledJumpID != request.id else { return }
        let animated = !UIAccessibility.isReduceMotionEnabled
        switch request.kind {
        case .end:
            collectionView.releasePromptAnchor()
            collectionView.isFollowing = true
            collectionView.scrollToEnd(animated: animated)
        case .anchorPrompt(let id):
            collectionView.anchorPromptToTop(id, animated: animated)
        }
    }

    // MARK: Scrolling

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        collectionView.endAnimatingToEnd()
        dragStart = scrollView.contentOffset.y
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        if scrollView.isDragging || scrollView.isDecelerating {
            let travelled = dragStart - scrollView.contentOffset.y
            let distance = collectionView.distanceFromEnd
            let following = callbacks.updateFollow {
                $0.dragged(travelled: travelled, distanceFromEnd: distance)
            }.isFollowing
            if !following { collectionView.releasePromptAnchor() }
            collectionView.isFollowing = following
        }
        checkNearTop()
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate { settle() }
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
        settle()
    }

    func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) {
        collectionView.endAnimatingToEnd()
    }

    func scrollViewDidScrollToTop(_ scrollView: UIScrollView) {
        collectionView.releasePromptAnchor()
        let distance = collectionView.distanceFromEnd
        collectionView.isFollowing = callbacks.updateFollow {
            $0.dragged(travelled: distance, distanceFromEnd: distance)
        }.isFollowing
    }

    private func settle() {
        collectionView.trimTailSpacerIfSafe()
        let distance = collectionView.distanceFromEnd
        let following = callbacks.updateFollow { $0.settled(distanceFromEnd: distance) }.isFollowing
        collectionView.isFollowing = following
        if following { collectionView.scrollToEnd(animated: !UIAccessibility.isReduceMotionEnabled) }
    }

    private func checkNearTop() {
        let view = collectionView
        guard view.bounds.height > 0 else { return }
        if view.contentOffset.y - view.minOffset < view.bounds.height * 1.5 { callbacks.nearTop() }
    }

    // MARK: Keyboard

    @objc private func keyboardWillChange(_ note: Notification) {
        let info = note.userInfo
        let duration = (info?[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber)?.doubleValue ?? 0.25
        let curve = (info?[UIResponder.keyboardAnimationCurveUserInfoKey] as? NSNumber)?.uintValue ?? 7
        keyboard = (duration, curve, .now)
    }

    @objc private func tapped() {
        callbacks.dismissKeyboard()
    }

    func gestureRecognizer(_ gesture: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        true
    }
}

private extension TranscriptEntry {
    var risesIn: Bool {
        if case .row(let row) = self { row.risesIn } else { false }
    }
}
