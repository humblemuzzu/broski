import ActivityKit
import BroskiCore
import Foundation
import os

enum LiveRunDecision: Equatable {
    /// Machines are reconnecting; keep whatever the Live Activity currently shows.
    case keep
    case show(RunActivityAttributes.ContentState)
    case none(endedAtMs: Int64)
}

/// Picks what the Live Activity shows from the inbox's rows: every live session, those that need
/// the person first and then the most recently updated, the first of them focused, its agent as
/// `brands` (machine id, then backend id) describes it.
struct LiveRunTracker {
    /// Fallback start times used only when connected to an older bridge that omits `runStartedAt`.
    private(set) var fallbackStarts: [InboxRow.Key: Int64] = [:]

    mutating func seed(key: InboxRow.Key, startedAtMs: Int64) {
        fallbackStarts[key] = startedAtMs
    }

    mutating func state(
        for rows: [InboxRow],
        brands: [String: [String: AgentBrand]] = [:],
        readyMachines: Set<String>? = nil,
        settlingMachines: Set<String> = [],
        now: Date
    ) -> LiveRunDecision {
        let nowMs = Int64(now.timeIntervalSince1970 * 1000)
        let ready = rows.filter {
            !$0.cached && (readyMachines?.contains($0.machineId) ?? true)
        }
        for row in ready where row.state == .done || row.state == .idle {
            fallbackStarts.removeValue(forKey: row.key)
        }
        let live = ready.filter { $0.state == .needsYou || $0.state == .working }.sorted {
            ($0.state == .needsYou ? 0 : 1, -$0.updatedAt) < ($1.state == .needsYou ? 0 : 1, -$1.updatedAt)
        }
        guard let focused = live.first else {
            return settlingMachines.isEmpty ? .none(endedAtMs: nowMs) : .keep
        }
        for row in live {
            if let authoritative = row.runStartedAt {
                fallbackStarts[row.key] = authoritative
            } else if fallbackStarts[row.key] == nil {
                fallbackStarts[row.key] = nowMs
            }
        }
        let startedAtMs = focused.runStartedAt ?? fallbackStarts[focused.key] ?? nowMs
        return .show(
            RunActivityAttributes.ContentState(
                phase: focused.phase,
                title: focused.displayTitle,
                machineId: focused.machineId,
                machineName: focused.machineName,
                backend: focused.session.backend,
                agent: brands[focused.machineId]?[focused.session.backend],
                sessionId: focused.session.sessionId,
                startedAtMs: startedAtMs,
                endedAtMs: nil,
                runs: live.prefix(RunActivityAttributes.ContentState.listed).map {
                    .init(title: $0.displayTitle, machineName: $0.machineName, phase: $0.phase)
                },
                liveCount: live.count,
                needsYouCount: live.count { $0.state == .needsYou }))
    }
}

private extension InboxRow {
    var phase: RunActivityAttributes.ContentState.Phase { state == .needsYou ? .needsYou : .working }

    /// Short enough that four of them keep the activity's state far inside ActivityKit's 4 KB.
    var displayTitle: String { String((title ?? "Untitled session").prefix(80)) }
}

/// Keeps one Live Activity in step with the inbox while any session is live, starts it immediately
/// when foregrounded, spaces repeated updates at least a second apart, observes system/user
/// dismissals, and publishes ActivityKit push tokens so the Mac daemon can update or end it while
/// the app is suspended in the background.
final class LiveRuns {
    static let minimumGap: Duration = .seconds(1)
    static let doneLingers: TimeInterval = 12
    nonisolated static let staleAfter: TimeInterval = 2 * 60 * 60

    var onPushToken: (String?) -> Void = { _ in }
    private(set) var currentPushToken: String?

    private var tracker = LiveRunTracker()
    private var isForeground = false
    /// Held by id because `Activity` is not `Sendable`.
    private var activityId: String?
    private var shown: RunActivityAttributes.ContentState?
    private var desired: LiveRunDecision = .keep
    private var dirty = false
    private var lastUpdate = ContinuousClock.now - LiveRuns.minimumGap
    private var worker: Task<Void, Never>?
    private var tokenObserver: Task<Void, Never>?
    private var stateObserver: Task<Void, Never>?

    /// Adopts the active Live Activity left by a previous run, and ends any duplicates.
    init() {
        let running = ActivityKit.Activity<RunActivityAttributes>.activities
        if let first = running.first, first.activityState == .active {
            activityId = first.id
            shown = first.content.state
            if let shown,
                let target = SessionTarget(machineId: shown.machineId, backend: shown.backend, sessionId: shown.sessionId)
            {
                let key = InboxRow.Key(machineId: target.machineId, session: target.session)
                tracker.seed(key: key, startedAtMs: shown.startedAtMs)
            }
            observe(activityId: first.id)
        }
        for stale in running.dropFirst().map(\.id) {
            Task { await Self.end(stale, with: nil, dismissal: .immediate) }
        }
    }

    deinit {
        worker?.cancel()
        tokenObserver?.cancel()
        stateObserver?.cancel()
    }

    var isShowing: Bool { activityId != nil }

    /// Waits, at most `limit`, until the activity no longer shows `key`'s run as live and nothing is
    /// left to apply, so a Stop that woke the app in the background ends the activity before the
    /// app pauses its link again (no push reaches it once paused).
    func settle(leaving key: InboxRow.Key, within limit: Duration) async {
        let deadline = ContinuousClock.now + limit
        while ContinuousClock.now < deadline, showsLive(key) || worker != nil {
            try? await Task.sleep(for: .milliseconds(100))
        }
    }

    private func showsLive(_ key: InboxRow.Key) -> Bool {
        guard let shown, shown.phase != .done else { return false }
        return shown.machineId == key.machineId && shown.sessionId == key.session.sessionId
            && shown.backend == key.session.backend
    }

    func setForeground(_ foreground: Bool) {
        guard isForeground != foreground else { return }
        isForeground = foreground
        if foreground { scheduleDrain() }
    }

    func follow(
        _ rows: [InboxRow],
        brands: [String: [String: AgentBrand]],
        readyMachines: Set<String>? = nil,
        settlingMachines: Set<String> = []
    ) {
        let decision = tracker.state(
            for: rows, brands: brands, readyMachines: readyMachines, settlingMachines: settlingMachines, now: .now)
        guard decision != .keep else { return }
        desired = decision
        dirty = true
        scheduleDrain()
    }

    private func scheduleDrain() {
        guard worker == nil else { return }
        worker = Task { [weak self] in
            guard let self else { return }
            await self.drain()
            self.worker = nil
            if self.dirty { self.scheduleDrain() }
        }
    }

    private func drain() async {
        while true {
            dirty = false
            reconcileDismissed()
            switch (activityId, desired) {
            case (_, .keep):
                return
            case (nil, .show(let state)):
                guard isForeground else { return }
                startActivity(state)
            case (let id?, .show(let state)):
                guard state != shown else { return }
                let wait = lastUpdate + Self.minimumGap - ContinuousClock.now
                if wait > .zero {
                    try? await Task.sleep(for: wait)
                    if dirty { continue }
                }
                guard let currentId = activityId, currentId == id, case .show(let latest) = desired else { continue }
                guard latest != shown else { return }
                lastUpdate = .now
                shown = latest
                await Self.update(id, to: latest)
            case (let id?, .none(let endedAtMs)):
                let previous = shown
                clearTracked()
                var done = previous
                done?.phase = .done
                done?.endedAtMs = endedAtMs
                done?.runs = []
                done?.liveCount = 0
                done?.needsYouCount = 0
                lastUpdate = .now
                await Self.end(id, with: done, dismissal: .after(.now.addingTimeInterval(Self.doneLingers)))
            case (nil, .none):
                return
            }
            if !dirty { return }
        }
    }

    private func startActivity(_ state: RunActivityAttributes.ContentState) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        do {
            let content = ActivityContent(
                state: state, staleDate: .now.addingTimeInterval(Self.staleAfter))
            let activity = try ActivityKit.Activity.request(
                attributes: RunActivityAttributes(), content: content, pushType: .token)
            activityId = activity.id
            shown = state
            lastUpdate = .now
            observe(activityId: activity.id)
        } catch {
            shown = nil
            Logger.core.error("the Live Activity did not start: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func reconcileDismissed() {
        guard let id = activityId else { return }
        guard let live = Self.activity(id), live.activityState == .active || live.activityState == .stale else {
            clearTracked()
            return
        }
    }

    private func clearTracked() {
        activityId = nil
        shown = nil
        tokenObserver?.cancel()
        tokenObserver = nil
        stateObserver?.cancel()
        stateObserver = nil
        if currentPushToken != nil {
            currentPushToken = nil
            onPushToken(nil)
        }
    }

    private func observe(activityId id: String) {
        tokenObserver?.cancel()
        stateObserver?.cancel()
        let handleToken: @MainActor @Sendable (String) -> Void = { [weak self] hex in
            guard let self, self.activityId == id, self.currentPushToken != hex else { return }
            self.currentPushToken = hex
            self.onPushToken(hex)
        }
        let handleEnded: @MainActor @Sendable () -> Void = { [weak self] in
            guard let self, self.activityId == id else { return }
            self.clearTracked()
        }
        tokenObserver = Task {
            await Self.watchTokens(id, onToken: handleToken)
        }
        stateObserver = Task {
            await Self.watchStates(id, onEnded: handleEnded)
        }
    }

    private nonisolated static func watchTokens(
        _ id: String, onToken: @MainActor @Sendable (String) -> Void
    ) async {
        guard let activity = activity(id) else { return }
        if let initial = activity.pushToken {
            await onToken(hexString(initial))
        }
        for await token in activity.pushTokenUpdates {
            await onToken(hexString(token))
        }
    }

    private nonisolated static func watchStates(
        _ id: String, onEnded: @MainActor @Sendable () -> Void
    ) async {
        guard let activity = activity(id) else { return }
        for await state in activity.activityStateUpdates {
            if state == .dismissed || state == .ended {
                await onEnded()
                return
            }
        }
    }

    private nonisolated static func hexString(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    private nonisolated static func update(_ id: String, to state: RunActivityAttributes.ContentState) async {
        let content = ActivityContent(state: state, staleDate: .now.addingTimeInterval(staleAfter))
        await activity(id)?.update(content)
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
