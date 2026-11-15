import SwiftUI

/// First run: what Broski does, the two commands to run on the Mac, and the two ways to pair.
struct WelcomeView: View {
    @Environment(\.startPairing) private var startPairing
    @ScaledMetric(relativeTo: .largeTitle) private var markSize: CGFloat = 72

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xxl) {
                    header
                    steps
                }
                .padding(.horizontal, Spacing.xl)
                .padding(.top, Spacing.xxxl)
                .padding(.bottom, Spacing.xl)
                .frame(maxWidth: 560, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
            actions
        }
        .background(Palette.screen)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            BroskiMark(side: markSize)
            Text("Broski")
                .font(.screenTitle)
            Text("Control Claude Code and Pi on your Mac from here.")
                .font(.title3)
                .foregroundStyle(.secondary)
        }
    }

    private var steps: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            Text("On your Mac, run")
                .font(.headline)
            VStack(alignment: .leading, spacing: 0) {
                StepRow(number: 1, command: "broski install")
                Divider().padding(.leading, Spacing.xxl + Spacing.l)
                StepRow(number: 2, command: "broski-link pair")
            }
            .background(Palette.card, in: .rect(cornerRadius: Radius.card, style: .continuous))
            Text("It shows a code to scan and prints a link you can paste.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private var actions: some View {
        GlassEffectContainer(spacing: Spacing.m) {
            VStack(spacing: Spacing.m) {
                Button {
                    startPairing(.scan)
                } label: {
                    WideLabel(title: "Scan Pairing Code", systemImage: "qrcode.viewfinder")
                }
                .primaryActionStyle()
                Button {
                    startPairing(.pasteFromClipboard())
                } label: {
                    WideLabel(title: "Paste Pairing Link", systemImage: "doc.on.clipboard")
                }
                .secondaryActionStyle()
            }
        }
        .frame(maxWidth: 560)
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.l)
    }
}

private struct StepRow: View {
    let number: Int
    let command: String

    var body: some View {
        HStack(spacing: Spacing.l) {
            Text(number, format: .number)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(Palette.accent)
                .frame(width: Spacing.xxl, height: Spacing.xxl)
                .background(Palette.accent.opacity(0.14), in: .circle)
                .accessibilityHidden(true)
            Text(command)
                .font(.code)
                .textSelection(.enabled)
            Spacer(minLength: 0)
        }
        .padding(Spacing.l)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Step \(number): \(command)")
    }
}
