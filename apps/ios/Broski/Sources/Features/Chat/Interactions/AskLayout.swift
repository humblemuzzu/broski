import SwiftUI

extension EnvironmentValues {
    /// How tall an ask's own content may grow before it scrolls: less while the keyboard is up, so
    /// the answers under it never leave the screen.
    @Entry var askContentCap: CGFloat = 320
    /// The agent's words above any ask (its body), drawn first inside the scrolling part.
    @Entry var askIntro: String?
}

/// What every ask shares under its header: the ask itself scrolling inside a cap, and its answers
/// pinned beneath it where the thumb is, so no length of ask pushes them away. Dragging the ask puts
/// the keyboard away.
struct AskBody<Content: View, Actions: View>: View {
    @ViewBuilder let content: () -> Content
    @ViewBuilder let actions: () -> Actions
    @Environment(\.askContentCap) private var cap
    @Environment(\.askIntro) private var intro

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.m) {
                    if let intro { FormattedMessage(text: intro, role: .quiet) }
                    content()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
            .scrollIndicators(.hidden)
            .frame(maxHeight: cap)
            .fixedSize(horizontal: false, vertical: true)
            actions()
        }
    }
}

/// One answer as a full-width button of the row it shares: the main one in ink, a refusal on glass in red, any other on glass.
struct AskButton: View {
    enum Look { case primary, secondary, destructive }

    let title: String
    var look: Look = .secondary
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.body.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .frame(maxWidth: .infinity)
        }
        .modifier(AskButtonLook(look: look))
        .controlSize(.large)
    }
}

private struct AskButtonLook: ViewModifier {
    let look: AskButton.Look

    func body(content: Content) -> some View {
        switch look {
        case .primary: content.prominentStyle()
        case .secondary: content.buttonStyle(.glass)
        case .destructive: content.buttonStyle(.glass).foregroundStyle(Palette.failed)
        }
    }
}

/// The quieter answers under the main ones, centred in a row, or one under another when they do not fit.
struct AskLinks<Links: View>: View {
    @ViewBuilder let links: () -> Links

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Spacing.xl) { links() }
            VStack(spacing: Spacing.s) { links() }
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(.secondary)
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        .padding(.top, Spacing.xxs)
    }
}

/// Words for the agent in place of the answer buttons: a way back, the field, focused, and the send
/// arrow that sends them.
struct AskReplyBar: View {
    let placeholder: String
    @Binding var text: String
    let sendLabel: String
    var canSend: Bool = true
    let cancel: () -> Void
    let send: () -> Void
    @FocusState private var focused: Bool

    private var ready: Bool { canSend && !text.trimmed.isEmpty }

    var body: some View {
        HStack(alignment: .bottom, spacing: Spacing.s) {
            Button(action: cancel) {
                Image(systemName: "xmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 44, height: 44)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .circle)
            .accessibilityLabel("Cancel")
            TextField(placeholder, text: $text, axis: .vertical)
                .lineLimit(1...4)
                .font(.body)
                .focused($focused)
                .padding(.horizontal, Spacing.l)
                .padding(.vertical, 11)
                .frame(minHeight: 44)
                .background(Color(uiColor: .tertiarySystemFill), in: .rect(cornerRadius: 22, style: .continuous))
            Button(action: send) {
                Image(systemName: "arrow.up")
                    .font(.body.weight(.bold))
                    .foregroundStyle(ready ? Palette.onAccent : Color.secondary)
                    .frame(width: 44, height: 44)
                    .background(ready ? Palette.accent : Color(uiColor: .tertiarySystemFill), in: .circle)
            }
            .buttonStyle(.plain)
            .disabled(!ready)
            .accessibilityLabel(sendLabel)
        }
        .onAppear { focused = true }
    }
}

extension View {
    /// A text field's quiet fill inside a card.
    func fieldBackground() -> some View {
        font(.body)
            .padding(.horizontal, Spacing.l)
            .padding(.vertical, 11)
            .frame(minHeight: 44)
            .background(Color(uiColor: .tertiarySystemFill), in: .rect(cornerRadius: 22, style: .continuous))
    }
}
