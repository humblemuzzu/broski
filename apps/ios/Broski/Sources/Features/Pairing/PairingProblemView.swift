import SwiftUI

struct PairingProblemView: View {
    let model: PairingModel
    let problem: PairingProblem
    let offer: PairingModel.Offer?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ContentUnavailableView {
            Label(offer.map { "Couldn't pair with \($0.name)" } ?? "Couldn't pair", systemImage: "exclamationmark.triangle")
        } description: {
            VStack(spacing: Spacing.s) {
                Text(problem.message)
                if let detail = problem.detail {
                    Text(detail)
                        .font(.codeSmall)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }
        } actions: {
            VStack(spacing: Spacing.m) {
                switch problem.next {
                case .tryAgain:
                    Button("Try Again") { Task { await model.pair() } }
                        .primaryActionStyle()
                case .scanAgain:
                    Button("Scan Again") { model.scanAgain() }
                        .primaryActionStyle()
                    Button("Paste Pairing Link") { model.pasted(.read()) }
                        .secondaryActionStyle()
                case .close:
                    Button("Close") { dismiss() }
                        .primaryActionStyle()
                }
            }
        }
        .navigationTitle("Pair")
        .navigationBarTitleDisplayMode(.inline)
    }
}
