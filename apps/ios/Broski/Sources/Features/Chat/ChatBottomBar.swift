import BroskiCore
import SwiftUI

/// Everything under the transcript: the pinned panel, then the jump-to-latest button and the
/// composer in one glass container, so the two merge when they meet.
struct ChatBottomBar: View {
    let chat: ChatModel
    let catalog: ComposerCatalog
    let agent: String
    let capabilities: Capabilities?
    let isReady: Bool
    @Binding var position: ScrollPosition
    @Binding var composing: Bool
    @State private var jumps = 0
    @Namespace private var glass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var modes: [PromptMode] { capabilities?.promptModes ?? [.start] }

    private var action: SendAction {
        SendAction.resolve(running: chat.isRunning, hasContent: chat.draft.hasContent, modes: modes)
    }

    var body: some View {
        GlassEffectContainer(spacing: Spacing.m) {
            VStack(alignment: .trailing, spacing: Spacing.s) {
                if !chat.follow.isFollowing {
                    JumpToLatest(unseen: chat.follow.unseen, jump: jump)
                        .glassEffectID("jump", in: glass)
                }
                PinnedPanel(chat: chat, agent: agent)
                if chat.canControl {
                    composer.glassEffectID("composer", in: glass)
                } else if chat.state.capabilities != nil {
                    WatchingBar(canAnswer: chat.canAnswer)
                }
            }
        }
        .padding(.horizontal, Spacing.m)
        .padding(.bottom, Spacing.xs)
        .animation(reduceMotion ? .easeOut(duration: 0.14) : .easeOut(duration: 0.24), value: chat.follow.isFollowing)
        .haptic(.snappedToLatest, trigger: jumps)
    }

    private var composer: some View {
        ComposerView(
            draft: Binding { chat.draft } set: { chat.draft = $0 },
            agent: agent, action: action, modes: modes,
            acceptsImages: capabilities?.attachments.contains(.image) ?? false,
            isEnabled: isReady, catalog: catalog,
            choices: ComposerChoices(chat.snapshot), choose: choose, perform: perform,
            refuse: { chat.report(ChatProblem(message: $0)) }, focus: $composing)
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
            case .model(let id): await chat.setModel(id)
            case .thinking(let value): await chat.setThinking(value)
            case .mode(let axis, let value): await chat.setMode(axis: axis, value: value)
            }
        }
    }

    private func jump() {
        jumps += 1
        chat.follow.jumped()
        withAnimation(reduceMotion ? nil : .spring(duration: 0.3, bounce: 0.1)) {
            position.scrollTo(id: TranscriptView.endId, anchor: .bottom)
        }
    }
}

/// Back to the end: a round glass button, or a capsule saying how many messages wait below.
private struct JumpToLatest: View {
    let unseen: Int
    let jump: () -> Void

    var body: some View {
        Button(action: jump) {
            HStack(spacing: Spacing.xs) {
                if unseen > 0 {
                    Text("^[\(unseen) new message](inflect: true)").font(.subheadline.weight(.medium))
                }
                Image(systemName: "arrow.down").font(.body.weight(.semibold))
            }
            .padding(.horizontal, unseen > 0 ? Spacing.m : 0)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .capsule)
        .accessibilityLabel(unseen > 0 ? "Jump to latest, \(unseen) new" : "Jump to latest")
        .transition(.scale(scale: 0.6).combined(with: .opacity))
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
