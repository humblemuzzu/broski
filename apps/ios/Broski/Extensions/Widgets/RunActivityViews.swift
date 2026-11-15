import AppIntents
import SwiftUI
import WidgetKit

typealias RunState = RunActivityAttributes.ContentState

/// The Lock Screen's activity: the focused session (agent, title, Mac, elapsed time, state, Stop),
/// then the other live sessions, each with its state as a word in its colour.
struct LockScreenRun: View {
    let state: RunState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                AgentTile(state: state, side: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.title).font(.headline).lineLimit(1)
                    Text("\(state.machineName) · \(state.agentName)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            if state.runs.count > 1 {
                VStack(alignment: .leading, spacing: 4) {
                    Text(state.summary)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(state.needsYouCount > 0 ? RunState.Phase.needsYou.tint : .secondary)
                    ForEach(Array(state.runs.dropFirst().enumerated()), id: \.offset) { _, run in
                        RunLine(run: run)
                    }
                }
            }
            HStack {
                PhaseLabel(phase: state.phase)
                Elapsed(state: state)
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: 96, alignment: .leading)
                Spacer()
                StopButton(state: state)
            }
        }
    }
}

/// Another live session: its title, its Mac, its state.
private struct RunLine: View {
    let run: RunState.Run

    var body: some View {
        HStack(spacing: 6) {
            Text(run.title).font(.subheadline).lineLimit(1)
            Text(run.machineName).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 6)
            Text(run.phase.title).font(.footnote.weight(.semibold)).foregroundStyle(run.phase.tint)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The agent's monogram on a neutral tile, as the app's agent mark draws it.
struct AgentTile: View {
    let state: RunState
    let side: CGFloat

    var body: some View {
        Text(state.monogram)
            .font(.system(size: side * 0.4, weight: .bold, design: .rounded))
            .foregroundStyle(.primary.opacity(0.75))
            .frame(width: side, height: side)
            .background(.fill.tertiary, in: .rect(cornerRadius: side * 0.3, style: .continuous))
            .accessibilityLabel(state.agentName)
    }
}

/// Time since the focused session went live, counting on its own in tabular figures; nothing once
/// it is done.
struct Elapsed: View {
    let state: RunState

    var body: some View {
        if state.phase != .done {
            Text(timerInterval: state.startedAt...Date.distantFuture, countsDown: false)
                .monospacedDigit()
        }
    }
}

/// A state as a word, an icon and a colour.
struct PhaseLabel: View {
    let phase: RunState.Phase

    var body: some View {
        Label(phase.title, systemImage: phase.symbol)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(phase.tint)
    }
}

struct PhaseIcon: View {
    let phase: RunState.Phase

    var body: some View {
        Image(systemName: phase.symbol)
            .foregroundStyle(phase.tint)
            .accessibilityLabel(phase.title)
    }
}

/// Stop runs `StopRunIntent` in the app, which aborts the focused run through the core.
struct StopButton: View {
    let state: RunState

    var body: some View {
        if state.phase != .done {
            Button(intent: StopRunIntent(machineId: state.machineId, backend: state.backend, sessionId: state.sessionId)) {
                Label("Stop", systemImage: "stop.fill")
                    .font(.subheadline.weight(.semibold))
            }
            .tint(.red)
            .accessibilityHint("Stops \(state.agentName)'s run on \(state.machineName)")
        }
    }
}

extension RunState.Phase {
    var tint: Color {
        switch self {
        case .working: .blue
        case .needsYou: .accentColor
        case .done: .green
        }
    }
}
