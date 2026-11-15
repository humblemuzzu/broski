import BroskiCore
import Foundation

/// What the person is writing: the text, a slash command picked from the list, and images.
nonisolated struct ComposerDraft: Equatable {
    var text = ""
    var command: CommandSummary?
    var images: [ComposerImage] = []

    var hasContent: Bool { !text.trimmed.isEmpty || !images.isEmpty || command != nil }

    /// What the images already take of the prompt's 4 MiB.
    var imageCost: Int { images.reduce(0) { $0 + $1.cost } }

    /// Input the backend handed back (`InputReturned`): its texts, a blank line between them, in front
    /// of what is already typed (contract §10).
    mutating func prepend(returned texts: [String]) {
        let returned = texts.joined(separator: "\n\n")
        guard !returned.isEmpty else { return }
        text = text.isEmpty ? returned : returned + "\n\n" + text
    }

    /// A prompt from the draft, with a fresh client request id.
    func input(mode: PromptMode) -> PromptInput {
        PromptInput(
            clientRequestId: UUID().uuidString.lowercased(), mode: mode, text: text.trimmed,
            attachments: images.map { .image($0.content) }, command: command?.id)
    }
}

/// A prompt the person sent that the agent has not shown as delivered yet: its bubble shows dimmed
/// until the `user_message` with its client request id arrives.
nonisolated struct PendingPrompt: Equatable, Identifiable {
    let id: String
    let draft: ComposerDraft
}

/// Each session's draft, kept while the app runs, so leaving a chat loses nothing; and the first
/// prompt of a session just created, which its chat sends once its view is attached.
final class DraftStore {
    private var drafts: [SessionTarget: ComposerDraft] = [:]
    private var firstPrompts: [SessionTarget: ComposerDraft] = [:]

    subscript(target: SessionTarget) -> ComposerDraft {
        get { drafts[target] ?? ComposerDraft() }
        set { drafts[target] = newValue.hasContent ? newValue : nil }
    }

    func setFirstPrompt(_ draft: ComposerDraft, for target: SessionTarget) {
        firstPrompts[target] = draft
    }

    func takeFirstPrompt(for target: SessionTarget) -> ComposerDraft? {
        firstPrompts.removeValue(forKey: target)
    }
}
