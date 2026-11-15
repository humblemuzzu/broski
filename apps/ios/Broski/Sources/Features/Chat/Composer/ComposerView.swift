import BroskiCore
import SwiftUI

/// The composer: one Liquid Glass surface holding the field (one line, growing to six), the slash
/// commands above it while the text starts with `/`, the attached images, and under the field `+`,
/// the chips and the one send button.
struct ComposerView: View {
    @Binding var draft: ComposerDraft
    let agent: String
    let action: SendAction
    let modes: [PromptMode]
    let acceptsImages: Bool
    let isEnabled: Bool
    let catalog: ComposerCatalog
    let choices: ComposerChoices
    let choose: (ComposerChoice) -> Void
    let perform: (SendAction) -> Void
    let refuse: (String) -> Void
    var focus: FocusState<Bool>.Binding

    private var placeholder: String {
        if action != .send { return "Message to queue…" }
        return catalog.commands.isEmpty ? "Message \(agent)" : "Message \(agent) · / for commands"
    }

    private var matching: [CommandSummary] {
        draft.commandQuery.map(catalog.commands(matching:)) ?? []
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            if !matching.isEmpty {
                CommandList(commands: matching) { draft.pick($0) }
                Divider()
            }
            if !draft.images.isEmpty {
                AttachmentStrip(draft: $draft)
            }
            if let command = draft.command {
                CommandToken(command: command) { draft.command = nil }
            }
            TextField(placeholder, text: $draft.text, axis: .vertical)
                .lineLimit(1...6)
                .focused(focus)
                .font(.body)
                .padding(.horizontal, Spacing.xs)
                .accessibilityLabel("Message")
                .accessibilityIdentifier("composer")
            HStack(spacing: Spacing.s) {
                if acceptsImages {
                    AttachmentMenu(draft: $draft, refuse: refuse)
                }
                FadingHorizontalScroll { ComposerChips(part: .model, catalog: catalog, choices: choices, choose: choose) }
                ComposerChips(part: .modes, catalog: catalog, choices: choices, choose: choose)
                SendButton(action: action, alternative: SendAction.alternative(to: action, modes: modes), canSend: draft.hasContent, perform: perform)
            }
        }
        .padding(.top, Spacing.m)
        .padding(.horizontal, Spacing.m)
        .padding(.bottom, Spacing.s)
        .glassEffect(.regular, in: .rect(cornerRadius: 26, style: .continuous))
        .disabled(!isEnabled)
        .animation(.spring(duration: 0.22, bounce: 0), value: matching.isEmpty)
        .animation(.spring(duration: 0.22, bounce: 0), value: draft.images.count)
    }
}

/// The picked command as a token in front of the field, removable.
private struct CommandToken: View {
    let command: CommandSummary
    let remove: () -> Void

    var body: some View {
        HStack(spacing: Spacing.xs) {
            Text("/" + command.name).font(.codeSmall.weight(.semibold))
            if let hint = command.argumentHint { Text(hint).font(.codeSmall).foregroundStyle(.secondary) }
            Button(action: remove) {
                Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove command")
        }
        .padding(.horizontal, Spacing.s)
        .padding(.vertical, Spacing.xs)
        .background(Palette.accent.opacity(0.14), in: .capsule)
    }
}

/// The one button: its face from `SendAction`; a long press offers the other way to send while a
/// run is live, each with its one-line explanation.
private struct SendButton: View {
    let action: SendAction
    let alternative: SendAction?
    let canSend: Bool
    let perform: (SendAction) -> Void
    @ScaledMetric(relativeTo: .body) private var scaledSide: CGFloat = 36

    /// Grows with the text, up to a size that leaves the chips beside it room.
    private var side: CGFloat { min(scaledSide, 52) }

    var body: some View {
        Group {
            if let alternative {
                Menu {
                    choice(action)
                    choice(alternative)
                } label: {
                    face
                } primaryAction: {
                    perform(action)
                }
            } else {
                Button { perform(action) } label: { face }
            }
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.circle)
        .tint(action == .stop ? Palette.failed : Palette.accent)
        .disabled(action == .wait || (action != .stop && !canSend))
        .accessibilityLabel(action.title)
        .accessibilityHint(alternative == nil ? "" : "Touch and hold for \(alternative?.title ?? "")")
        .animation(.spring(duration: 0.22, bounce: 0.1), value: action)
    }

    private var face: some View {
        Image(systemName: action.symbol)
            .font(.body.weight(.semibold))
            .contentTransition(.symbolEffect(.replace))
            .frame(width: side - 14, height: side - 14)
    }

    private func choice(_ way: SendAction) -> some View {
        Button { perform(way) } label: {
            Label {
                Text(way.title)
                Text(way.explanation)
            } icon: {
                Image(systemName: way.symbol)
            }
        }
    }
}
