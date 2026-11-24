import BroskiCore
import SwiftUI

/// Everything under the transcript: the pinned panel, then the composer, in one glass container.
/// The composer is there from the first frame, typing included, whatever the link is doing; only
/// sending waits for a session this phone may drive. A session a terminal on the Mac runs says so
/// in its place. An ask takes the composer's place, its answers where the thumb is; folded, it
/// becomes a pill over the composer.
struct ChatBottomBar: View {
    let chat: ChatModel
    let catalog: ComposerCatalog
    let agent: String
    let capabilities: Capabilities?
    let isReady: Bool
    let dictation: DictationTarget
    var fileSearch: FileSearchSource? = nil
    @Binding var composing: Bool
    /// The ask the person folded away, so the composer shows under its pill.
    @State private var folded: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var modes: [PromptMode] { capabilities?.promptModes ?? [.start] }

    private var action: SendAction {
        SendAction.resolve(running: chat.isRunning, hasContent: chat.draft.hasContent, modes: modes)
    }

    /// Only a session the bridge said this phone may not drive shows no composer.
    private var watchesOnly: Bool { chat.state.capabilities.map { !$0.controllable } ?? false }

    var body: some View {
        GlassEffectContainer(spacing: Spacing.m) {
            VStack(alignment: .trailing, spacing: Spacing.s) {
                PinnedPanel(chat: chat, agent: agent)
                if let ask = chat.interactions.first, folded != ask.id {
                    InteractionPanel(chat: chat, interaction: ask, agent: agent) { folded = ask.id }
                        .id(ask.id)
                        .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                } else {
                    if let ask = chat.interactions.first {
                        AskPill(interaction: ask, waiting: chat.interactions.count - 1) { folded = nil }
                            .transition(.opacity)
                    }
                    if watchesOnly {
                        WatchingBar(canAnswer: chat.canAnswer)
                    } else {
                        composer
                    }
                }
            }
        }
        .padding(.horizontal, Spacing.m)
        .padding(.bottom, Spacing.xs)
        .animation(reduceMotion ? .easeOut(duration: 0.14) : .spring(duration: 0.32, bounce: 0.12), value: shownAsk)
        .onChange(of: shownAsk) { _, ask in
            if ask != nil { composing = false }
        }
    }

    /// The ask on screen in the composer's place, if one is.
    private var shownAsk: String? {
        chat.interactions.first.map(\.id).flatMap { $0 == folded ? nil : $0 }
    }

    private var composer: some View {
        ComposerView(
            draft: Binding { chat.draft } set: { chat.draft = $0 },
            backend: chat.session.backend, action: action, modes: modes,
            acceptsImages: capabilities?.attachments.contains(.image) ?? false,
            isEnabled: isReady && chat.canControl, catalog: catalog,
            choices: ComposerChoices(chat.snapshot, pending: chat.pendingChoice), choose: choose, perform: perform,
            refuse: { chat.report(ChatProblem(message: $0)) }, focus: $composing, dictation: dictation,
            fileSearch: fileSearch, cache: chat.snapshot.usage?.cache)
    }

    private func perform(_ action: SendAction) {
        if action == .stop {
            Task { await chat.stop() }
            return
        }
        composing = false
        Task { await chat.send(action) }
    }

    private func choose(_ choice: ComposerChoice) {
        Task {
            switch choice {
            case .model(let id, let thinking): await chat.setModel(id, thinking: thinking)
            case .thinking(let value): await chat.setThinking(value)
            case .mode(let axis, let value): await chat.setMode(axis: axis, value: value)
            }
        }
    }
}

/// A session this phone may watch but not drive (one a terminal on the Mac runs).
private struct WatchingBar: View {
    let canAnswer: Bool

    var body: some View {
        Label(
            canAnswer
                ? "Running in your Mac's terminal. You can answer here and reply once this turn finishes."
                : "Running in your Mac's terminal. You can reply once this turn finishes.",
            systemImage: "terminal")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.horizontal, Spacing.l)
            .padding(.vertical, Spacing.m)
            .frame(maxWidth: .infinity)
            .glassEffect(.regular, in: .capsule)
    }
}
