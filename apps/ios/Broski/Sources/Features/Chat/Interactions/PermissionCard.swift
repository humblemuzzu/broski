import BroskiCore
import SwiftUI

/// A tool permission: what the agent wants to do, exactly (the command, the files with their diffs,
/// the host, the paths, its arguments), why, and the backend's options in its order: the plain
/// allow-once as the one prominent button, wider allows beside it, and Deny with a field to tell the
/// agent what to do instead (sent as the reply's `message`). A deliberate request confirms first.
struct PermissionCard: View {
    let interaction: Interaction
    let request: ToolPermissionRequest
    let agent: String
    let isSending: Bool
    let send: (InteractionReply) -> Void
    @State private var instead = ""
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
        VStack(alignment: .leading, spacing: Spacing.m) {
            Text(headline).font(.headline)
            PermissionPreviews(request: request, toolName: interaction.origin?.toolName)
            if let reason = request.reason ?? interaction.body {
                FormattedMessage(text: reason, role: .quiet)
            }
            if !request.grants.isEmpty { grantToggles }
            actions
        }
        .confirmationDialog(
            confirming?.label ?? "", isPresented: Binding { confirming != nil } set: { if !$0 { confirming = nil } },
            titleVisibility: .visible, presenting: confirming
        ) { option in
            Button(option.label, role: option.effect == .deny ? .destructive : nil) { choose(option, confirmed: true) }
        } message: { _ in
            Text("\(agent) asked for this to be answered deliberately.")
        }
    }

    private var headline: String {
        switch request.previews.first {
        case .command: "\(agent) wants to run"
        case .fileChanges: "\(agent) wants to change files"
        case .network(let host): "\(agent) wants to reach \(host.host)"
        case .paths: "\(agent) wants to use these paths"
        case nil: interaction.title
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

    private var actions: some View {
        GlassEffectContainer(spacing: Spacing.s) {
            VStack(spacing: Spacing.s) {
                if let primary = answer.primary {
                    optionButton(primary).buttonStyle(.glassProminent)
                }
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: Spacing.s) { otherAllows }
                    VStack(spacing: Spacing.s) { otherAllows }
                }
                if let deny = answer.denyWithMessage {
                    HStack(spacing: Spacing.s) {
                        TextField("Tell \(agent) what to do instead", text: $instead, axis: .vertical)
                            .lineLimit(1...3)
                            .font(.subheadline)
                            .padding(.horizontal, Spacing.m)
                            .padding(.vertical, Spacing.s)
                            .background(Color(uiColor: .tertiarySystemFill), in: .rect(cornerRadius: 18, style: .continuous))
                        optionButton(deny, wide: false).buttonStyle(.glass).tint(Palette.failed).controlSize(.regular)
                    }
                }
                ForEach(answer.otherDenies, id: \.id) { option in
                    optionButton(option).buttonStyle(.borderless).tint(Palette.failed)
                }
            }
        }
        .controlSize(.large)
        .disabled(isSending)
    }

    private var otherAllows: some View {
        ForEach(answer.otherAllows, id: \.id) { option in
            optionButton(option).buttonStyle(.glass).controlSize(.regular)
        }
    }

    private func optionButton(_ option: PermissionOption, wide: Bool = true) -> some View {
        Button { choose(option, confirmed: false) } label: {
            Text(agentLine(option.label))
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: wide ? .infinity : nil)
        }
        .disabled(!answer.canSend(option, message: instead, grants: grants))
    }

    private func choose(_ option: PermissionOption, confirmed: Bool) {
        if request.deliberate && !confirmed {
            confirming = option
            return
        }
        send(answer.reply(option, message: instead, grants: grants))
    }
}

/// The exact thing being approved: never truncated, scrolling when long; the call's arguments as
/// the work fold shows them.
private struct PermissionPreviews: View {
    let request: ToolPermissionRequest
    let toolName: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            ForEach(request.previews.indices, id: \.self) { index in
                preview(request.previews[index])
            }
            let facts = ToolFacts(name: toolName ?? "", title: nil, input: request.input, hasChildSession: false, changedPaths: [])
            let arguments = toolArguments(facts: facts)
            if !arguments.isEmpty {
                ToolArgumentsView(rows: arguments)
                    .padding(Spacing.m)
                    .background(Palette.codeBackground, in: .rect(cornerRadius: Radius.small + 4, style: .continuous))
            }
        }
    }

    @ViewBuilder
    private func preview(_ preview: PermissionPreview) -> some View {
        switch preview {
        case .command(let command):
            CodeLines(text: command.command, caption: command.cwd, isCommand: true)
        case .fileChanges(let files):
            ForEach(files.changes, id: \.path) { change in
                NavigationLink(value: Route.toolDiff(change)) { FileChangeRow(change: change) }
                    .buttonStyle(.plain)
            }
        case .network(let network):
            CodeLines(text: [network.protocol, network.host].compactMap(\.self).joined(separator: "://"))
        case .paths(let paths):
            CodeLines(text: paths.paths.joined(separator: "\n"))
        }
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
        .padding(Spacing.m)
        .background(Palette.codeBackground, in: .rect(cornerRadius: Radius.small + 4, style: .continuous))
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
