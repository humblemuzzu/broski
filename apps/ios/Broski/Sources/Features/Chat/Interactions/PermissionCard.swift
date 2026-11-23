import BroskiCore
import SwiftUI

/// A tool permission: exactly what the agent wants to do (the command with its arguments and
/// folder in one block, the files with their diffs, the host, the paths), why, and the answers
/// pinned under it: Deny and Allow side by side, the wider allows and Reply beneath. Reply turns the
/// buttons into a field whose words go to the agent with the deny. A deliberate request confirms first.
struct PermissionCard: View {
    let interaction: Interaction
    let request: ToolPermissionRequest
    let agent: String
    let isSending: Bool
    let send: (InteractionReply) -> Void
    @State private var instead = ""
    @State private var replying = false
    @State private var grants: Set<String>
    @State private var confirming: PermissionOption?

    init(interaction: Interaction, request: ToolPermissionRequest, agent: String, isSending: Bool, send: @escaping (InteractionReply) -> Void) {
        self.interaction = interaction
        self.request = request
        self.agent = agent
        self.isSending = isSending
        self.send = send
        _grants = State(initialValue: Set(request.grants.map(\.id)))
    }

    private var answer: PermissionAnswer { PermissionAnswer(request: request) }

    var body: some View {
        AskBody {
            PermissionPreviews(request: request, toolName: interaction.origin?.toolName)
            if let reason = request.reason {
                FormattedMessage(text: reason, role: .quiet)
            }
            if !request.grants.isEmpty { grantToggles }
        } actions: {
            actions
        }
        .disabled(isSending)
        .animation(.spring(duration: 0.28, bounce: 0.12), value: replying)
        .confirmationDialog(
            confirming?.label ?? "", isPresented: Binding { confirming != nil } set: { if !$0 { confirming = nil } },
            titleVisibility: .visible, presenting: confirming
        ) { option in
            Button(option.label, role: option.effect == .deny ? .destructive : nil) { choose(option, confirmed: true) }
        } message: { _ in
            Text("\(agent) asked for this to be answered deliberately.")
        }
    }

    @ViewBuilder
    private var actions: some View {
        if replying, let deny = answer.denyWithMessage {
            AskReplyBar(
                placeholder: "Tell \(agent) what to do instead", text: $instead, sendLabel: "Deny with this reply",
                canSend: answer.canSend(deny, message: instead, grants: grants),
                cancel: { replying = false }, send: { choose(deny, confirmed: false) })
            .transition(.opacity.combined(with: .scale(scale: 0.98)))
        } else {
            VStack(spacing: Spacing.m) {
                GlassEffectContainer(spacing: Spacing.s) {
                    HStack(spacing: Spacing.s) {
                        if let deny = answer.plainDeny {
                            AskButton(title: agentLine(deny.label), look: .destructive) { pick(deny) }
                        }
                        if let allow = answer.primary {
                            AskButton(title: agentLine(allow.label), look: .primary) { choose(allow, confirmed: false) }
                                .disabled(!answer.canSend(allow, message: "", grants: grants))
                        }
                    }
                }
                let wider = answer.otherAllows
                if !wider.isEmpty || answer.denyWithMessage != nil {
                    AskLinks {
                        ForEach(wider, id: \.id) { option in
                            Button(agentLine(option.label)) { choose(option, confirmed: false) }
                                .disabled(!answer.canSend(option, message: "", grants: grants))
                        }
                        if answer.denyWithMessage != nil {
                            Button("Reply…") { replying = true }
                                .accessibilityLabel("Reply to \(agent) instead")
                        }
                    }
                }
            }
            .transition(.opacity)
        }
    }

    private var grantToggles: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            ForEach(request.grants, id: \.id) { grant in
                Toggle(isOn: Binding { grants.contains(grant.id) } set: { on in
                    if on { grants.insert(grant.id) } else { grants.remove(grant.id) }
                }) {
                    Text(grant.words).font(.subheadline)
                }
            }
        }
    }

    /// The Deny beside Allow: one that needs words opens the reply field first.
    private func pick(_ deny: PermissionOption) {
        if deny.message == .required {
            replying = true
        } else {
            choose(deny, confirmed: false)
        }
    }

    private func choose(_ option: PermissionOption, confirmed: Bool) {
        if request.deliberate && !confirmed {
            confirming = option
            return
        }
        send(answer.reply(option, message: replying ? instead : "", grants: grants))
    }
}

/// The exact thing being approved, never truncated: a command with its arguments and folder in one
/// block; files that open to their diffs; a host or paths.
private struct PermissionPreviews: View {
    let request: ToolPermissionRequest
    let toolName: String?

    private var arguments: [ToolArgument] {
        let facts = ToolFacts(name: toolName ?? "", title: nil, input: request.input, hasChildSession: false, changedPaths: [])
        return toolArguments(facts: facts)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            ForEach(request.previews.indices, id: \.self) { index in
                preview(request.previews[index], arguments: index == 0 ? arguments : [])
            }
            if request.previews.isEmpty && !arguments.isEmpty {
                CodeBlock { ToolArgumentsView(rows: arguments) }
            }
        }
    }

    @ViewBuilder
    private func preview(_ preview: PermissionPreview, arguments: [ToolArgument]) -> some View {
        switch preview {
        case .command(let command):
            CodeBlock {
                ScrollView { CommandLineView(command: command.command) }
                    .frame(maxHeight: 160)
                    .fixedSize(horizontal: false, vertical: true)
                if !arguments.isEmpty { ToolArgumentsView(rows: arguments) }
                if let cwd = command.cwd {
                    Text("in \(cwd)").font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.head)
                }
            }
        case .fileChanges(let files):
            ForEach(files.changes, id: \.path) { change in
                RouteLink(value: Route.toolDiff(change)) { FileChangeRow(change: change) }
                    .buttonStyle(.plain)
            }
            if !arguments.isEmpty { CodeBlock { ToolArgumentsView(rows: arguments) } }
        case .network(let network):
            CodeLines(text: [network.protocol, network.host].compactMap(\.self).joined(separator: "://"))
        case .paths(let paths):
            CodeLines(text: paths.paths.joined(separator: "\n"))
        }
    }
}

/// Code on the code background, as one block.
private struct CodeBlock<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.m)
            .background(Color.primary.opacity(0.06), in: .rect(cornerRadius: 14, style: .continuous))
    }
}

/// Monospaced text exactly as written, wrapping, scrolling past a few lines: a command coloured as
/// shell, or paths and hosts with their links found.
struct CodeLines: View {
    let text: String
    var caption: String?
    var isCommand = false

    /// Lines of a preview kept; what is approved is shown whole up to this.
    private static let maxLines: UInt32 = 2_000

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            ScrollView {
                if isCommand {
                    CommandLineView(command: text)
                } else {
                    LogLinesView(log: formatLog(text: text, maxLines: Self.maxLines, keep: .head), tint: .primary)
                }
            }
            .frame(maxHeight: 160)
            .fixedSize(horizontal: false, vertical: true)
            if let caption {
                Text("in \(caption)").font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.head)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Spacing.m)
        .background(Color.primary.opacity(0.06), in: .rect(cornerRadius: 14, style: .continuous))
    }
}

extension PermissionGrant {
    var words: String {
        let target = target.map { " \($0)" } ?? ""
        return switch kind {
        case .network: "Network access" + target
        case .read: "Read" + target
        case .write: "Write" + target
        case .deny: "Keep out of" + target
        }
    }
}
