import BorderBeamKit
import BroskiCore
import SwiftUI
import VoiceGlowKit

/// The composer: one Liquid Glass surface holding the field (one line, growing to six; Paste takes
/// images), the slash commands above it while the text starts with `/`, the attached images, and
/// under the field `+`, the chips, the mic and the one send button. While dictating, the recording
/// takes the field's place and ✕ the place of `+` and the chips, and a glow rises from the bottom edge
/// with the voice. A beam rides its rim while a run is live.
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
    @Binding var focus: Bool
    /// Where dictated text goes; `nil` shows no mic.
    var dictation: DictationTarget?
    /// Project file search for `@file` mentions; `nil` when no working folder is known.
    var fileSearch: FileSearchSource? = nil
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var voiceSettings = false
    @State private var mentionPaths: [String] = []
    @State private var mentionCache = FileMentionCache()
    @State private var cursorUtf16: Int? = nil

    private var dictationPhase: Dictation.Phase {
        dictation.map { app.dictation.phase(for: $0.id) } ?? .idle
    }

    private var isDictating: Bool { dictationPhase != .idle }

    /// Recording and not about to be cancelled: the voice glow shows.
    private var isListening: Bool {
        if case .recording(_, cancelling: false) = dictationPhase { true } else { false }
    }

    private var placeholder: String {
        if action != .send { return "Message to queue…" }
        return catalog.commands.isEmpty ? "Message \(agent)" : "Message \(agent) · / for commands"
    }

    private var matching: [CommandSummary] {
        draft.commandQuery.map(catalog.commands(matching:)) ?? []
    }

    private var activeMention: FileMention? {
        matching.isEmpty ? draft.fileMention(at: cursorUtf16) : nil
    }

    private var mentionTaskKey: String? {
        guard let fileSearch, let mention = activeMention else { return nil }
        return "\(fileSearch.root)\u{0}\(mention.query)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            if !matching.isEmpty {
                CommandList(commands: matching) { draft.pick($0) }
                Divider()
            } else if !mentionPaths.isEmpty, activeMention != nil {
                FileMentionList(paths: mentionPaths) {
                    if let nextCursor = draft.pickFile($0, at: cursorUtf16) {
                        cursorUtf16 = nextCursor
                    }
                    mentionPaths = []
                }
                Divider()
            }
            if !draft.images.isEmpty {
                AttachmentStrip(draft: $draft)
            }
            if let command = draft.command {
                CommandToken(command: command) { draft.command = nil }
            }
            if isDictating {
                RecordingBar(dictation: app.dictation, phase: dictationPhase) { voiceSettings = true }
                    .padding(.horizontal, Spacing.xs)
                    .transition(.opacity)
            } else {
                ComposerTextView(
                    placeholder: placeholder, text: $draft.text, isFocused: $focus, cursorUtf16: $cursorUtf16, maxLines: 6,
                    pasteImages: acceptsImages ? { attach($0, to: $draft, refuse: refuse) } : nil,
                    onSubmit: { if draft.hasContent { perform(action) } }
                )
                .padding(.horizontal, Spacing.xs)
            }
            if let dictation, let notice = app.dictation.notice(for: dictation.id) {
                Text(notice.text)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, Spacing.xs)
                    .transition(.opacity)
            }
            controls
        }
        .padding(.top, Spacing.m)
        .padding(.horizontal, Spacing.m)
        .padding(.bottom, Spacing.s)
        .glassEffect(.regular, in: .rect(cornerRadius: 26, style: .continuous))
        .borderBeam(.md, theme: .auto, active: action != .send && !reduceMotion, borderRadius: 26)
        .voiceGlow(levelProvider: { Double(app.dictation.level) }, active: isListening, cornerRadius: 26)
        .disabled(!isEnabled)
        .animation(.spring(duration: 0.22, bounce: 0), value: matching.isEmpty)
        .animation(.spring(duration: 0.22, bounce: 0), value: mentionPaths.isEmpty)
        .animation(.spring(duration: 0.22, bounce: 0), value: draft.images.count)
        .animation(.spring(duration: 0.22, bounce: 0), value: isDictating)
        .task(id: mentionTaskKey) {
            guard let fileSearch, let mention = activeMention else {
                mentionPaths = []
                return
            }
            if let cached = mentionCache.get(root: fileSearch.root, query: mention.query) {
                mentionPaths = cached
                return
            }
            try? await Task.sleep(for: .milliseconds(120))
            guard !Task.isCancelled else { return }
            guard let results = await fileSearch.search(mention.query) else {
                if !Task.isCancelled { mentionPaths = [] }
                return
            }
            guard !Task.isCancelled else { return }
            mentionCache.put(root: fileSearch.root, query: mention.query, paths: results)
            mentionPaths = results
        }
        .sensoryFeedback(trigger: app.dictation.feedback) { _, feedback in
            app.dictation.feedbackOwner == dictation?.id ? feedback?.moment.feedback : nil
        }
        .onDisappear {
            if let dictation { app.dictation.composerLeft(dictation.id) }
        }
        .sheet(isPresented: $voiceSettings) {
            NavigationStack { VoiceSettingsScreen(closes: true) }
        }
    }

    private var controls: some View {
        HStack(spacing: Spacing.s) {
            if isDictating {
                if case .failed = dictationPhase {} else {
                    CancelDictation { app.dictation.cancel() }
                }
                Spacer(minLength: 0)
            } else {
                if acceptsImages {
                    AttachmentMenu(draft: $draft, refuse: refuse)
                }
                FadingHorizontalScroll { ComposerChips(part: .model, catalog: catalog, choices: choices, choose: choose) }
                ComposerChips(part: .modes, catalog: catalog, choices: choices, choose: choose)
            }
            if let dictation {
                MicButton(
                    phase: dictationPhase,
                    press: { app.dictation.press(dictation, touch: $0) },
                    slide: { app.dictation.slide(cancelling: $0) },
                    release: { app.dictation.release(held: $0) })
                    .disabled(app.dictation.isBusy(apartFrom: dictation.id))
            }
            if !isDictating {
                SendButton(action: action, alternative: SendAction.alternative(to: action, modes: modes), canSend: draft.hasContent, perform: perform)
            }
        }
    }
}

/// ✕ in place of `+` while dictating: throws the recording away.
private struct CancelDictation: View {
    let cancel: () -> Void

    var body: some View {
        Button(action: cancel) {
            Image(systemName: "xmark")
                .font(.body.weight(.medium))
                .frame(width: 32, height: 32)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .accessibilityLabel("Cancel dictation")
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
