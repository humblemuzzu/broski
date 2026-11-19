import SwiftUI
import ThinkingOrbsKit

/// What the scanned offer says before anything is sent: the Mac's name, how long the code lasts,
/// and whether this phone already controls that Mac. While pairing, a glass card holds the progress.
struct OfferPreview: View {
    let model: PairingModel
    let offer: PairingModel.Offer
    @ScaledMetric(relativeTo: .largeTitle) private var symbolSize: CGFloat = 64

    private var isPairing: Bool {
        if case .pairing = model.step { true } else { false }
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let countdown = offer.countdown(at: context.date)
            VStack(spacing: Spacing.xl) {
                ScrollView {
                    details(countdown: countdown)
                        .padding(.horizontal, Spacing.xl)
                        .padding(.top, Spacing.xxxl)
                }
                .scrollBounceBehavior(.basedOnSize)
                actions(expired: countdown == nil)
                    .padding(.horizontal, Spacing.xl)
                    .padding(.bottom, Spacing.l)
            }
        }
        .opacity(isPairing ? 0.35 : 1)
        .overlay {
            if isPairing {
                progress.transition(.scale(scale: 0.92).combined(with: .opacity))
            }
        }
        .navigationTitle("Pair")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func details(countdown: ClosedRange<Date>?) -> some View {
        VStack(spacing: Spacing.l) {
            Image(systemName: "laptopcomputer")
                .font(.system(size: symbolSize, weight: .light))
                .foregroundStyle(Palette.accent)
                .accessibilityHidden(true)
            Text(offer.name)
                .font(.title.bold())
                .multilineTextAlignment(.center)
            if let countdown {
                HStack(spacing: Spacing.xs) {
                    Text("Code expires in")
                    Text(timerInterval: countdown, countsDown: true)
                        .monospacedDigit()
                }
                .foregroundStyle(.secondary)
                .accessibilityElement(children: .combine)
            } else {
                Label("This code expired. Run broski-link pair again.", systemImage: "clock.badge.xmark")
                    .foregroundStyle(Palette.failed)
            }
            if offer.alreadyPaired {
                Label("Already paired. Pairing again replaces it.", systemImage: "checkmark.seal")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .multilineTextAlignment(.center)
    }

    @ViewBuilder
    private func actions(expired: Bool) -> some View {
        if expired {
            Button { model.scanAgain() } label: { WideLabel(title: "Scan Again", systemImage: "qrcode.viewfinder") }
                .primaryActionStyle()
        } else {
            Button {
                Task { await model.pair() }
            } label: {
                WideLabel(title: "Pair with \(offer.name)")
            }
            .primaryActionStyle()
            .disabled(isPairing)
        }
    }

    private var progress: some View {
        VStack(spacing: Spacing.l) {
            Orb(.connecting, side: 64)
            Text("Pairing with \(offer.name)…")
                .font(.headline)
                .multilineTextAlignment(.center)
        }
        .padding(Spacing.xxl)
        .glassCard()
        .padding(Spacing.xl)
        .accessibilityElement(children: .combine)
    }
}
