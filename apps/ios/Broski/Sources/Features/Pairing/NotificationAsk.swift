import SwiftUI

/// Right after the first pairing: one line on why, then iOS's own prompt.
struct NotificationAsk: View {
    let model: PairingModel
    let machineName: String
    @ScaledMetric(relativeTo: .largeTitle) private var symbolSize: CGFloat = 56

    var body: some View {
        VStack(spacing: Spacing.xl) {
            ScrollView {
                VStack(spacing: Spacing.l) {
                    Image(systemName: "bell.badge.fill")
                        .font(.system(size: symbolSize))
                        .symbolRenderingMode(.hierarchical)
                        .foregroundStyle(Palette.accent)
                        .accessibilityHidden(true)
                    Text("Paired with \(machineName)")
                        .font(.title2.bold())
                    Text("Turn on notifications so you can approve from the lock screen.")
                        .foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.center)
                .padding(.horizontal, Spacing.xl)
                .padding(.top, Spacing.xxxl)
            }
            .scrollBounceBehavior(.basedOnSize)
            VStack(spacing: Spacing.m) {
                Button {
                    Task { await model.askNotifications() }
                } label: {
                    WideLabel(title: "Turn On Notifications")
                }
                .primaryActionStyle()
                Button("Not Now") { model.skipNotifications() }
                    .controlSize(.large)
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.bottom, Spacing.l)
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
    }
}
