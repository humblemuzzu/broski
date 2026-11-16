import ActivityKit
import BroskiCore
import Foundation
import os

/// Picks what the Live Activity shows from the inbox's rows: every live session, those that need
/// the person first and then the most recently updated, the first of them focused.
struct LiveRunTracker {
    /// When each live session was first seen live, for the activity's elapsed time.
    private(set) var firstSeen: [InboxRow.Key: Date] = [:]

    mutating func state(for rows: [InboxRow], now: Date) -> RunActivityAttributes.ContentState? {
        let live = rows.filter { $0.state == .needsYou || $0.state == .working }.sorted {
            ($0.state == .needsYou ? 0 : 1, -$0.updatedAt) < ($1.state == .needsYou ? 0 : 1, -$1.updatedAt)
        }
        let keys = Set(live.map(\.key))
        firstSeen = firstSeen.filter { keys.contains($0.key) }
        for key in keys where firstSeen[key] == nil { firstSeen[key] = now }
        guard let focused = live.first else { return nil }
        return RunActivityAttributes.ContentState(
            phase: focused.phase,
            title: focused.displayTitle,
            machineId: focused.machineId,
            machineName: focused.machineName,
            backend: focused.session.backend.wireName,
            sessionId: focused.session.sessionId,
            startedAt: firstSeen[focused.key] ?? now,
            runs: live.prefix(RunActivityAttributes.ContentState.listed).map {
                .init(title: $0.displayTitle, machineName: $0.machineName, phase: $0.phase)
            },
            liveCount: live.count,
            needsYouCount: live.count { $0.state == .needsYou })
    }
}

private extension InboxRow {
    var phase: RunActivityAttributes.ContentState.Phase { state == .needsYou ? .needsYou : .working }

    /// Short enough that four of them keep the activity's state far inside ActivityKit's 4 KB.
    var displayTitle: String { String((title ?? "Untitled session").prefix(80)) }
}

/// Keeps one Live Activity in step with the inbox while any session is live, ends it as "Done"
/// for a few seconds when none is, and spaces its updates at least a second apart. Updates come
/// only while the app runs: the relay sends no ActivityKit pushes, so a suspended app leaves the
/// activity as it was until the app runs again (the elapsed time still counts on its own).
final class LiveRuns {
    static let minimumGap: Duration = .seconds(1)
    static let doneLingers: TimeInterval = 8

    private var tracker = LiveRunTracker()
    /// The activity is held by id: ActivityKit's `Activity` is not `Sendable`, so each change looks
    /// it up where it is used.
    private var activityId: String?
    private var shown: RunActivityAttributes.ContentState?
    private var lastUpdate = ContinuousClock.now - LiveRuns.minimumGap
    private var pending: Task<Void, Never>?

    /// Adopts the activity a previous run of the app left, and ends any beyond it.
    init() {
        let running = ActivityKit.Activity<RunActivityAttributes>.activities
        activityId = running.first?.id
        shown = running.first?.content.state
        for stale in running.dropFirst().map(\.id) {
            Task { await Self.end(stale, with: nil, dismissal: .immediate) }
        }
    }

    func follow(_ rows: [InboxRow]) {
        let state = tracker.state(for: rows, now: .now)
        guard state != shown else { return }
        pending?.cancel()
        let wait = lastUpdate + Self.minimumGap - ContinuousClock.now
        pending = Task { [weak self] in
            if wait > .zero { try? await Task.sleep(for: wait) }
            guard !Task.isCancelled else { return }
            await self?.show(state)
        }
    }

    private func show(_ state: RunActivityAttributes.ContentState?) async {
        let previous = shown
        lastUpdate = .now
        shown = state
        switch (activityId, state) {
        case (nil, let state?):
            do {
                activityId = try ActivityKit.Activity.request(
                    attributes: RunActivityAttributes(), content: ActivityContent(state: state, staleDate: nil)
                ).id
            } catch {
                shown = nil
                Logger.core.error("the Live Activity did not start: \(error.localizedDescription, privacy: .public)")
            }
        case (let id?, let state?):
            await Self.update(id, to: state)
        case (let id?, nil):
            activityId = nil
            var done = previous
            done?.phase = .done
            done?.runs = []
            done?.liveCount = 0
            done?.needsYouCount = 0
            await Self.end(id, with: done, dismissal: .after(.now.addingTimeInterval(Self.doneLingers)))
        case (nil, nil):
            break
        }
    }

    private nonisolated static func update(_ id: String, to state: RunActivityAttributes.ContentState) async {
        await activity(id)?.update(ActivityContent(state: state, staleDate: nil))
    }

    private nonisolated static func end(
        _ id: String, with state: RunActivityAttributes.ContentState?, dismissal: ActivityUIDismissalPolicy
    ) async {
        await activity(id)?.end(state.map { ActivityContent(state: $0, staleDate: nil) }, dismissalPolicy: dismissal)
    }

    private nonisolated static func activity(_ id: String) -> ActivityKit.Activity<RunActivityAttributes>? {
        ActivityKit.Activity<RunActivityAttributes>.activities.first { $0.id == id }
    }
}
