import BroskiCore
import SwiftUI
import ThinkingOrbsKit

/// What the one live indicator under the run says (design.md, "One live indicator").
enum LaneStatus: Equatable {
    /// A run with nothing to show yet.
    case starting
    /// Reasoning is the newest block streaming (Android's rule too).
    case thinking
    case working
    case waitingForApproval
    case waitingForAnswer
    case compacting
    case retrying(retryAt: Int64?)

    /// From the live state alone: an ask that blocks the run first, then a compaction, a retry, a
    /// run that has shown nothing, reasoning streaming last, any run. `nil` when nothing is live.
    init?(_ snapshot: SessionSnapshot) {
        if let ask = snapshot.interactions.first(where: \.blocksRun) {
            if case .toolPermission = ask.request { self = .waitingForApproval } else { self = .waitingForAnswer }
        } else if snapshot.compaction != nil {
            self = .compacting
        } else if let retry = snapshot.retry {
            self = .retrying(retryAt: retry.retryAt)
        } else if let run = snapshot.run {
            let shown = snapshot.blocks.contains { $0.kind != .thinking || !$0.text.isEmpty }
                || run.items.contains { if case .userMessage = $0 { false } else { true } }
            if !shown {
                self = .starting
            } else if snapshot.blocks.last?.kind == .thinking {
                self = .thinking
            } else {
                self = .working
            }
        } else {
            return nil
        }
    }

    func title(at now: Date) -> String {
        switch self {
        case .starting: return "Starting"
        case .thinking: return "Thinking"
        case .working: return "Working"
        case .waitingForApproval: return "Waiting for your approval"
        case .waitingForAnswer: return "Waiting for your answer"
        case .compacting: return "Compacting context…"
        case .retrying(let retryAt):
            let seconds = retryAt.map { Int(Date(unixMilliseconds: $0).timeIntervalSince(now).rounded(.up)) } ?? 0
            return seconds > 0 ? "Retrying in \(seconds) s" : "Retrying…"
        }
    }

    /// The orb beside the words; none while the run waits on the person.
    var orb: OrbState? {
        switch self {
        case .starting, .thinking: .breathing
        case .working: .working
        case .compacting: .weaving
        case .retrying: .connecting
        case .waitingForApproval, .waitingForAnswer: nil
        }
    }
}

/// The lane under the live run: a thinking orb, one shimmering line and how long the run has gone,
/// its height kept when nothing is live so the rows above never move when it comes and goes.
struct StatusLaneView: View {
    let status: LaneStatus?
    /// When the live run began, shown while the agent works rather than waits on the person.
    var startedAt: Int64?
    @ScaledMetric(relativeTo: .subheadline) private var height: CGFloat = 24

    var body: some View {
        HStack(spacing: Spacing.s) {
            if let orb = status?.orb {
                Orb(orb, side: 20, relativeTo: .subheadline)
                    .id(orb)
                    .transition(.opacity)
            }
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                if let status {
                    if case .retrying = status {
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            title(status.title(at: context.date))
                        }
                    } else {
                        HStack(spacing: Spacing.xs) {
                            title(status.title(at: .now))
                            if let startedAt, status.orb != nil {
                                Text("·")
                                ElapsedTime(since: startedAt)
                            }
                        }
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.tertiary)
                    }
                }
            }
        }
        .frame(minHeight: height, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(.easeOut(duration: 0.2), value: status)
    }

    private func title(_ words: String) -> some View {
        Text(words)
            .font(.subheadline.weight(.medium))
            .shimmer(true)
            .contentTransition(.opacity)
            .accessibilityAddTraits(.updatesFrequently)
    }
}
