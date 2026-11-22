import SwiftUI

/// Liquid Glass belongs to the control layer only: bars, floating controls, the one primary
/// action. Content (rows, bubbles, diffs) never takes it. Glass cannot sample glass, so controls
/// that sit together go in one `GlassEffectContainer`.
extension View {
    /// The one primary action of a screen.
    func primaryActionStyle() -> some View {
        prominentStyle().controlSize(.large)
    }

    /// Prominent glass in the accent, its label in the colour that reads on the accent.
    func prominentStyle() -> some View {
        buttonStyle(.glassProminent).foregroundStyle(Palette.onAccent)
    }

    /// An action beside the primary one.
    func secondaryActionStyle() -> some View {
        buttonStyle(.glass).controlSize(.large)
    }

    /// A card pinned above the composer (what runs in the background, a notice, the queue), on the
    /// same glass as the composer it sits on.
    func panelCard() -> some View {
        glassEffect(.regular, in: .rect(cornerRadius: Radius.panel, style: .continuous))
    }

    /// A floating card on the control layer (pairing progress), in concentric-friendly corners.
    func glassCard() -> some View {
        glassEffect(.regular, in: .rect(cornerRadius: Radius.sheetCard, style: .continuous))
    }
}

/// A button label that fills its row, for stacked full-width actions.
struct WideLabel: View {
    let title: String
    var systemImage: String?

    var body: some View {
        Group {
            if let systemImage {
                Label(title, systemImage: systemImage)
            } else {
                Text(title)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// A floating capsule of controls with an optional control beside it (a composer: the field and
/// its buttons in the capsule, send or stop beside it), both in one container so they blend and
/// morph as the accessory comes and goes.
struct GlassCapsuleBar<Bar: View, Accessory: View>: View {
    var spacing: CGFloat = Spacing.s
    @ViewBuilder var bar: () -> Bar
    @ViewBuilder var accessory: () -> Accessory

    var body: some View {
        GlassEffectContainer(spacing: spacing) {
            HStack(alignment: .bottom, spacing: spacing) {
                bar()
                    .padding(.horizontal, Spacing.m)
                    .padding(.vertical, Spacing.s)
                    .frame(minHeight: 44)
                    .glassEffect(.regular.interactive(), in: .capsule)
                accessory()
            }
        }
    }
}
