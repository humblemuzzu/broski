import GhosttyTerminal
import SwiftUI

/// The keys a phone keyboard lacks, in one glass row under the terminal: esc, a sticky ctrl, tab,
/// arrows that repeat while held, `|`, `~`, `/`, and paste. Every key goes through the emulator,
/// which encodes it for the program's key mode and applies an armed ctrl to it.
struct TerminalKeyBar: View {
    let state: TerminalViewState
    @State private var ctrl: TerminalPublicStickyActivation = .inactive

    var body: some View {
        ScrollView(.horizontal) {
            GlassEffectContainer(spacing: Spacing.xs) {
                HStack(spacing: Spacing.xs) {
                    key("esc", label: "Escape") { $0.sendKey(.escape) }
                    ctrlKey
                    key("tab", label: "Tab") { $0.sendKey(.tab) }
                    arrow("arrow.left", label: "Left Arrow", .arrowLeft)
                    arrow("arrow.up", label: "Up Arrow", .arrowUp)
                    arrow("arrow.down", label: "Down Arrow", .arrowDown)
                    arrow("arrow.right", label: "Right Arrow", .arrowRight)
                    ForEach(["|", "~", "/"], id: \.self) { symbol in
                        key(symbol, label: symbol) { view in
                            if let press = TerminalKeyPress(typing: Character(symbol)) { view.sendKey(press) }
                        }
                    }
                    PasteButton(payloadType: String.self) { texts in
                        state.paste(text: texts.joined())
                    }
                    .labelStyle(.iconOnly)
                    .buttonBorderShape(.capsule)
                }
                .padding(.horizontal, Spacing.m)
                .padding(.vertical, Spacing.xs)
            }
        }
        .scrollIndicators(.hidden)
        .font(.system(.subheadline, design: .monospaced).weight(.semibold))
    }

    private var ctrlKey: some View {
        Button {
            guard let view = state.attachedPlatformView else { return }
            view.setStickyModifierChangeHandler { [weak view] in
                ctrl = view?.stickyActivation(for: .ctrl) ?? .inactive
            }
            view.toggleStickyModifier(.ctrl)
            ctrl = view.stickyActivation(for: .ctrl)
        } label: {
            Text("ctrl")
        }
        .buttonStyle(KeyCapStyle(active: ctrl != .inactive))
        .accessibilityLabel("Control")
        .accessibilityValue(ctrl == .locked ? "Locked" : ctrl == .armed ? "On for the next key" : "Off")
        .accessibilityHint("Applies Control to the next key. Tap twice to keep it on.")
    }

    private func key(_ title: String, label: String, send: @escaping (TerminalView) -> Void) -> some View {
        Button {
            if let view = state.attachedPlatformView { send(view) }
        } label: {
            Text(title)
        }
        .buttonStyle(KeyCapStyle(active: false))
        .accessibilityLabel(label)
    }

    private func arrow(_ symbol: String, label: String, _ key: TerminalKey) -> some View {
        Button {
            state.attachedPlatformView?.sendKey(key)
        } label: {
            Image(systemName: symbol)
        }
        .buttonStyle(KeyRepeatStyle())
        .accessibilityLabel(label)
    }
}

/// A key cap on the glass: a capsule that answers the touch.
private struct KeyCap: ViewModifier {
    let active: Bool
    @ScaledMetric(relativeTo: .subheadline) private var height: CGFloat = 36

    func body(content: Content) -> some View {
        content
            .foregroundStyle(active ? Color.white : Color.primary)
            .frame(minWidth: 44, minHeight: max(height, 36))
            .padding(.horizontal, Spacing.xs)
            .glassEffect(active ? .regular.tint(Palette.accent).interactive() : .regular.interactive(), in: .capsule)
            .contentShape(.capsule)
    }
}

private struct KeyCapStyle: ButtonStyle {
    let active: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .modifier(KeyCap(active: active))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// A key that sends once on touch down, then again and again while held, as a keyboard repeats.
private struct KeyRepeatStyle: PrimitiveButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        RepeatingKey(configuration: configuration)
    }
}

private struct RepeatingKey: View {
    let configuration: PrimitiveButtonStyle.Configuration
    @State private var pressed = false

    var body: some View {
        configuration.label
            .modifier(KeyCap(active: false))
            .opacity(pressed ? 0.7 : 1)
            .onLongPressGesture(minimumDuration: .infinity, maximumDistance: 44, perform: {}) { pressed = $0 }
            .task(id: pressed) {
                guard pressed else { return }
                configuration.trigger()
                try? await Task.sleep(for: .milliseconds(400))
                while !Task.isCancelled {
                    configuration.trigger()
                    try? await Task.sleep(for: .milliseconds(70))
                }
            }
    }
}
