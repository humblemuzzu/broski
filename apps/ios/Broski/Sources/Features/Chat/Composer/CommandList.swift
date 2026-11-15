import BroskiCore
import SwiftUI

/// The slash commands above the field while the text starts with `/`, filtered as the person types.
/// Picking one makes it the prompt's command; what follows its name stays as its arguments.
struct CommandList: View {
    let commands: [CommandSummary]
    let pick: (CommandSummary) -> Void

    static let height: CGFloat = 200

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(commands, id: \.id) { command in
                    Button { pick(command) } label: { row(command) }
                        .buttonStyle(.plain)
                }
            }
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(maxHeight: Self.height)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func row(_ command: CommandSummary) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                Text("/" + command.name).font(.code.weight(.medium))
                if let hint = command.argumentHint {
                    Text(hint).font(.codeSmall).foregroundStyle(.tertiary)
                }
                Spacer(minLength: Spacing.s)
                if command.kind != .command {
                    Text(command.kind.word).font(.caption).foregroundStyle(.secondary)
                }
            }
            if let description = command.description {
                Text(description).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .padding(.vertical, Spacing.s)
        .padding(.horizontal, Spacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }
}

extension CommandKind {
    var word: String {
        switch self {
        case .command: "Command"
        case .skill: "Skill"
        case .prompt: "Prompt"
        }
    }
}

extension ComposerDraft {
    /// What follows a `/` the person is typing at the start of the field, while no command is
    /// picked: the filter for the list. `nil` when the list should not show.
    var commandQuery: String? {
        guard command == nil, text.hasPrefix("/") else { return nil }
        let query = text.dropFirst()
        guard !query.contains(where: \.isWhitespace) else { return nil }
        return String(query)
    }

    mutating func pick(_ picked: CommandSummary) {
        command = picked
        text = ""
    }
}
