import AppIntents
import SwiftUI
import ThinkingOrbsKit
import WidgetKit

typealias RunState = RunActivityAttributes.ContentState

/// The Lock Screen's activity on the system's own material. One live session: its agent, title, state
/// with the time it has run, and Stop. Several: how many run and how many need the person, then
/// each of them on a line.
struct LockScreenRun: View {
    let state: RunState
    var isStale = false

    var body: some View {
        if state.isMany {
            ManyRuns(state: state, isStale: isStale)
        } else {
            OneRun(state: state, isStale: isStale)
        }
    }
}

private struct OneRun: View {
    let state: RunState
    let isStale: Bool

    var body: some View {
        HStack(spacing: 12) {
            AgentLogo(brand: state.brand, side: 42)
            VStack(alignment: .leading, spacing: 3) {
                Text(state.title)
                    .font(.headline)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                StatusLine(state: state, isStale: isStale)
                    .font(.subheadline)
            }
            Spacer(minLength: 8)
            StopButton(state: state)
        }
    }
}

private struct ManyRuns: View {
    let state: RunState
    let isStale: Bool

    private static let shown = 3
    private var more: Int { max(0, state.liveCount - min(state.runs.count, Self.shown)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(state.countLine)
                    .font(.headline)
                    .foregroundStyle(.primary)
                if let needsYou = state.needsYouLine {
                    Text("·").foregroundStyle(.tertiary)
                    Text(needsYou)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(RunState.Phase.needsYou.tint)
                }
                Spacer(minLength: 0)
                if isStale {
                    Text("Paused").font(.footnote).foregroundStyle(.tertiary)
                }
            }
            .lineLimit(1)
            VStack(alignment: .leading, spacing: 7) {
                ForEach(Array(state.runs.prefix(Self.shown).enumerated()), id: \.offset) { _, run in
                    RunLine(run: run, showsMachine: state.spansMachines)
                }
                if more > 0 {
                    Text("+\(more) more")
                        .font(.footnote)
                        .foregroundStyle(.tertiary)
                        .padding(.leading, 14)
                }
            }
        }
    }
}

/// One live session among several: its state as a dot, its title (and Mac, when they run on more
/// than one), its state as a word when it needs the person.
struct RunLine: View {
    let run: RunState.Run
    var showsMachine = false

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(run.phase == .working ? Color.primary.opacity(0.35) : run.phase.tint).frame(width: 6, height: 6)
            Text(run.title).font(.subheadline).foregroundStyle(.primary).lineLimit(1)
            if showsMachine {
                Text(run.machineName).font(.footnote).foregroundStyle(.tertiary).lineLimit(1)
            }
            Spacer(minLength: 6)
            if run.phase != .working {
                Text(run.phase.title).font(.footnote.weight(.semibold)).foregroundStyle(run.phase.tint)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// "Working · 2:56", "Needs you", "Done · 4:12": the focused run's state and the time it has run.
struct StatusLine: View {
    let state: RunState
    var isStale = false

    var body: some View {
        HStack(spacing: 5) {
            PhaseIcon(phase: state.phase)
                .font(.footnote)
            Text(state.phase.title)
                .foregroundStyle(state.phase == .working ? AnyShapeStyle(.secondary) : AnyShapeStyle(state.phase.tint))
            if showsTime {
                Text("·").foregroundStyle(.tertiary)
                Elapsed(state: state, isStale: isStale)
                    .foregroundStyle(.secondary)
            }
        }
        .lineLimit(1)
    }

    private var showsTime: Bool {
        isStale || state.phase == .working || (state.phase == .done && state.endedAt != nil)
    }
}

/// Time since the focused run started: counts live while working, freezes at `endedAt` once done,
/// and shows "Paused" when the activity became stale offline.
struct Elapsed: View {
    let state: RunState
    var isStale = false

    var body: some View {
        if isStale && state.phase != .done {
            Text("Paused")
        } else if state.phase == .working {
            Text(timerInterval: state.startedAt...Date.distantFuture, countsDown: false)
                .monospacedDigit()
                .contentTransition(.numericText())
        } else if state.phase == .done, let endedAt = state.endedAt {
            Text(Self.format(max(0, endedAt.timeIntervalSince(state.startedAt))))
                .monospacedDigit()
        }
    }

    static func format(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let secs = total % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, secs)
        }
        return String(format: "%d:%02d", minutes, secs)
    }
}

struct PhaseIcon: View {
    let phase: RunState.Phase

    var body: some View {
        ZStack {
            if let symbol = phase.symbol {
                Image(systemName: symbol).foregroundStyle(phase.tint)
            } else {
                ThinkingOrb(state: .working, size: .px20, theme: .auto, paused: true, displaySize: 14)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(phase.title)
    }
}

/// Stop runs `StopRunIntent` in the app, which aborts the focused run through the core: a quiet
/// round button, there only while the run is live.
struct StopButton: View {
    let state: RunState
    var side: CGFloat = 36

    var body: some View {
        if state.phase != .done {
            Button(intent: StopRunIntent(machineId: state.machineId, backend: state.backend, sessionId: state.sessionId)) {
                Image(systemName: "stop.fill")
                    .font(.system(size: side * 0.36, weight: .bold))
                    .foregroundStyle(.primary)
                    .frame(width: side, height: side)
                    .background(Color.primary.opacity(0.12), in: .circle)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Stop")
            .accessibilityHint("Stops \(state.agentName)'s run")
        }
    }
}
