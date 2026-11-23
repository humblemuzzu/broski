import BroskiCore
import SwiftUI
import VoiceGlowKit

/// The composer, one Liquid Glass surface in two shapes. Collapsed, while the person is not writing:
/// a capsule of `+`, the field, the mic, and Stop while a run is live. Expanded, once the field is
/// touched or holds something: the field across the top, growing to six lines, and under it `+`,
/// the model pill, the mic and the send button. Above the field, when there are any: the slash
/// commands while the text starts with `/`, the `@` file matches, the attached images and the
/// picked command. While dictating the recording takes the field's line and ✕ the place of `+`,
/// and a glow rises from the bottom edge with the voice. While the Mac is out of reach the field
/// still takes typing; only what needs the Mac (sending, the pickers) waits.
struct ComposerView: View {
    @Binding var draft: ComposerDraft
    /// The agent the pinned models and remembered levels are kept for.
    let backend: String?
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
    /// The session's prompt cache, which the model sheet warns about; `nil` before a session exists.
    var cache: CacheWindow? = nil
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var voiceSettings = false
    @State private var pickingModel = false
    /// The sheet takes the keyboard; the field gets it back when the sheet goes if it had it.
    @State private var refocusAfterSheet = false
    @State private var steps = 0
    @State private var mentionPaths: [String] = []
    @State private var mentionCache = FileMentionCache()
    @State private var cursorUtf16: Int? = nil

    private var dictationPhase: Dictation.Phase {
        dictation.map { app.dictation.phase(for: $0.id) } ?? .idle
    }

    private var isDictating: Bool { dictationPhase != .idle }

    private var dictationFailed: Bool {
        if case .failed = dictationPhase { true } else { false }
    }

    /// Recording and not about to be cancelled: the voice glow shows.
    private var isListening: Bool {
        if case .recording(_, cancelling: false) = dictationPhase { true } else { false }
    }

    private var isExpanded: Bool {
        focus || draft.hasContent || dictationFailed || !matching.isEmpty
    }

    private var showsPickers: Bool { isExpanded && !isDictating }

    /// With nothing to send and nothing running, the mic ends the row; Send comes in with the text.
    private var showsSend: Bool { dictation == nil || action != .send || draft.hasContent }

    private var placeholder: String {
        if action != .send, modes.contains(.queue) { return "Queue a message" }
        return !isExpanded && dictation != nil ? "Type or hold to talk" : "Chat with Broski"
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
            accessories
            ComposerLayout(expanded: isExpanded) {
                ZStack { leading }
                field
                ComposerPickers(catalog: catalog, choices: choices, choose: step(choose), openModel: openModel)
                    .disabled(!isEnabled)
                    .opacity(showsPickers ? 1 : 0)
                    .allowsHitTesting(showsPickers)
                    .accessibilityHidden(!showsPickers)
                trailing
            }
        }
        .padding(ComposerMetrics.inset)
        .background {
            Color.clear
                .contentShape(.rect)
                .onTapGesture { focus = true }
        }
        .glassEffect(.regular, in: .rect(cornerRadius: ComposerMetrics.radius, style: .continuous))
        .voiceGlow(levelProvider: { Double(app.dictation.level) }, active: isListening, cornerRadius: ComposerMetrics.radius)
        .animation(reduceMotion ? .easeOut(duration: 0.15) : .spring(duration: 0.34, bounce: 0.1), value: isExpanded)
        .animation(.snappy(duration: 0.22), value: showsSend)
        .animation(.snappy(duration: 0.22), value: isDictating)
        .animation(.spring(duration: 0.22, bounce: 0), value: matching.isEmpty)
        .animation(.spring(duration: 0.22, bounce: 0), value: mentionPaths.isEmpty)
        .animation(.spring(duration: 0.22, bounce: 0), value: draft.images.count)
        .haptic(.pickerStep, trigger: steps)
        .task(id: mentionTaskKey) { await searchMentions() }
        .sensoryFeedback(trigger: app.dictation.feedback) { _, feedback in
            app.dictation.feedbackOwner == dictation?.id ? feedback?.moment.feedback : nil
        }
        .onDisappear {
            if let dictation { app.dictation.composerLeft(dictation.id) }
        }
        .sheet(isPresented: $voiceSettings) {
            NavigationStack { VoiceSettingsScreen(closes: true) }
        }
        .sheet(isPresented: $pickingModel, onDismiss: refocus) {
            ModelSheet(backend: backend ?? "", catalog: catalog, choices: choices, cache: cache, choose: step(choose))
        }
    }

    @ViewBuilder
    private var accessories: some View {
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
                .padding(.horizontal, ComposerLayout.fieldInset)
        }
        if let command = draft.command {
            CommandToken(command: command) { draft.command = nil }
                .padding(.horizontal, ComposerLayout.fieldInset)
        }
        if let dictation, let notice = app.dictation.notice(for: dictation.id) {
            Text(notice.text)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.horizontal, ComposerLayout.fieldInset)
                .transition(.opacity)
        }
    }

    @ViewBuilder
    private var leading: some View {
        if isDictating && !dictationFailed {
            CancelDictation { app.dictation.cancel() }
                .transition(.opacity)
        } else if acceptsImages {
            AttachmentMenu(draft: $draft, refuse: refuse)
                .transition(.opacity)
        }
    }

    private var field: some View {
        ZStack(alignment: .leading) {
            if isDictating {
                RecordingBar(dictation: app.dictation, phase: dictationPhase) { voiceSettings = true }
                    .transition(.opacity)
            } else {
                ComposerTextView(
                    placeholder: placeholder, text: $draft.text, isFocused: $focus, cursorUtf16: $cursorUtf16, maxLines: 6,
                    pasteImages: acceptsImages ? { attach($0, to: $draft, refuse: refuse) } : nil,
                    onSubmit: { if isEnabled && draft.hasContent { perform(action) } }
                )
                .accessibilityActions {
                    if !catalog.models.isEmpty { Button("Choose Model", action: openModel) }
                }
            }
        }
    }

    private var trailing: some View {
        HStack(spacing: ComposerLayout.spacing) {
            if let dictation {
                MicButton(
                    phase: dictationPhase,
                    press: { app.dictation.press(dictation, touch: $0) },
                    slide: { app.dictation.slide(cancelling: $0) },
                    release: { app.dictation.release(held: $0) })
                    .disabled(app.dictation.isBusy(apartFrom: dictation.id))
            }
            if showsSend {
                SendButton(
                    action: action, alternative: SendAction.alternative(to: action, modes: modes),
                    canSend: draft.hasContent && !isDictating, perform: perform)
                    .disabled(!isEnabled)
                    .transition(.scale(scale: 0.6).combined(with: .opacity))
            }
        }
    }

    private func openModel() {
        refocusAfterSheet = focus
        pickingModel = true
    }

    private func refocus() {
        guard refocusAfterSheet else { return }
        refocusAfterSheet = false
        focus = true
    }

    private func step(_ choose: @escaping (ComposerChoice) -> Void) -> (ComposerChoice) -> Void {
        { choice in
            steps += 1
            choose(choice)
        }
    }

    private func searchMentions() async {
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
        .background(Color.composerFill, in: .capsule)
    }
}
