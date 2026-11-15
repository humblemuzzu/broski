import SwiftUI

/// The pairing flow in one sheet: scanner → offer preview → pairing → notification ask.
struct PairingSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var model: PairingModel?
    let start: PairingStart

    var body: some View {
        NavigationStack {
            Group {
                if let model {
                    PairingStepView(model: model)
                }
            }
            .toolbar {
                if canCancel {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel", systemImage: "xmark", role: .cancel) { dismiss() }
                            .disabled(isPairing)
                    }
                }
            }
        }
        .interactiveDismissDisabled(isPairing)
        .haptic(.confirmed, trigger: model?.pairedMachine)
        .haptic(.failed, trigger: isProblem, when: { !$0 && $1 })
        .onChange(of: model?.step) { _, step in
            if step == .finished { dismiss() }
        }
        .onAppear {
            if model == nil { model = PairingModel(start: start, app: app) }
        }
    }

    private var isPairing: Bool {
        if case .pairing = model?.step { true } else { false }
    }

    private var canCancel: Bool {
        switch model?.step {
        case .askNotifications, .finished: false
        default: true
        }
    }

    private var isProblem: Bool {
        if case .problem = model?.step { true } else { false }
    }
}

private struct PairingStepView: View {
    let model: PairingModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            switch model.step {
            case .scanning:
                ScanStep(model: model)
                    .transition(.opacity)
            case .preview(let offer), .pairing(let offer):
                OfferPreview(model: model, offer: offer)
                    .transition(.rise(reduceMotion: reduceMotion))
            case .problem(let problem, let offer):
                PairingProblemView(model: model, problem: problem, offer: offer)
                    .transition(.rise(reduceMotion: reduceMotion))
            case .askNotifications(let name):
                NotificationAsk(model: model, machineName: name)
                    .transition(.rise(reduceMotion: reduceMotion))
            case .finished:
                Color.clear
            }
        }
        .animation(Motion.spring(reduceMotion: reduceMotion), value: model.step)
    }
}
