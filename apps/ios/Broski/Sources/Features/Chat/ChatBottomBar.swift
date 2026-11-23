import BroskiCore
import SwiftUI

/// Everything under the transcript: the pinned panel, then the composer, in one glass container.
/// The composer is there from the first frame, typing included, whatever the link is doing; only
/// sending waits for a session this phone may drive. A session a terminal on the Mac runs says so
/// in its place.
struct ChatBottomBar: View {
    let chat: ChatModel
    let catalog: ComposerCatalog
    let agent: String
    let capabilities: Capabilities?
    let isReady: Bool
    let dictation: DictationTarget
    var fileSearch: FileSearchSource? = nil
    @Binding var composing: Bool

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
                if watchesOnly {
                    WatchingBar(canAnswer: chat.canAnswer)
                } else {
                    composer
                }
            }
        }
        .padding(.horizontal, Spacing.m)
        .padding(.bottom, Spacing.xs)
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
            canAnswer ? "Running in your Mac's terminal. You can answer its questions here." : "Running in your Mac's terminal.",
            systemImage: "terminal")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.horizontal, Spacing.l)
            .padding(.vertical, Spacing.m)
            .frame(maxWidth: .infinity)
            .glassEffect(.regular, in: .capsule)
    }
}
