import AppIntents
import SwiftUI
import WidgetKit

typealias RunState = RunActivityAttributes.ContentState

/// The Lock Screen's activity on Broski's navy: the brand, the focused session (its agent's logo,
/// title, Mac), the other live sessions, then the state, the elapsed time and Stop.
struct LockScreenRun: View {
    let state: RunState

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            BrandLine(state: state)
            HStack(alignment: .center, spacing: 12) {
                AgentLogo(brand: state.brand, side: 46)
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.title)
                        .font(.headline)
                        .foregroundStyle(ActivityStyle.primary)
                        .lineLimit(2)
                    Text("\(state.machineName) · \(state.agentName)")
                        .font(.subheadline)
                        .foregroundStyle(ActivityStyle.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            if state.runs.count > 1 {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(state.runs.dropFirst().enumerated()), id: \.offset) { _, run in
                        RunLine(run: run)
                    }
                }
                .padding(.leading, 58)
            }
            HStack(spacing: 10) {
                PhasePill(phase: state.phase)
                Elapsed(state: state)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(ActivityStyle.secondary)
                    .frame(maxWidth: 80, alignment: .leading)
                Spacer()
                StopButton(state: state)
            }
        }
    }
}

/// Broski's mark and name, with the count across every Mac when more than one agent is live.
private struct BrandLine: View {
    let state: RunState

    var body: some View {
        HStack(spacing: 6) {
            Image("BroskiMark")
                .resizable()
                .frame(width: 20, height: 20)
                .clipShape(.rect(cornerRadius: 5, style: .continuous))
                .accessibilityHidden(true)
            Text("Broski")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(ActivityStyle.secondary)
            Spacer(minLength: 8)
            if state.liveCount > 1 {
                Text(state.summary)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(state.needsYouCount > 0 ? RunState.Phase.needsYou.tint : ActivityStyle.secondary)
                    .lineLimit(1)
            }
        }
    }
}

/// Another live session: its state as a dot, its title and Mac, its state as a word.
private struct RunLine: View {
    let run: RunState.Run

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(run.phase.tint).frame(width: 6, height: 6)
            Text(run.title).font(.subheadline).foregroundStyle(ActivityStyle.primary).lineLimit(1)
            Text(run.machineName).font(.footnote).foregroundStyle(ActivityStyle.tertiary).lineLimit(1)
            Spacer(minLength: 6)
            Text(run.phase.title).font(.footnote.weight(.semibold)).foregroundStyle(run.phase.tint)
        }
        .accessibilityElement(children: .combine)
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

/// A state as an icon and a word on a capsule of its colour.
struct PhasePill: View {
    let phase: RunState.Phase

    var body: some View {
        Label(phase.title, systemImage: phase.symbol)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(phase.tint)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(phase.tint.opacity(0.16), in: .capsule)
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
                    .font(.footnote.weight(.semibold))
                    .padding(.horizontal, 4)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .tint(.red)
            .accessibilityHint("Stops \(state.agentName)'s run on \(state.machineName)")
        }
    }
}
