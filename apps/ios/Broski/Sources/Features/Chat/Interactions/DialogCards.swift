import BroskiCore
import SwiftUI

/// A plan to approve: the plan, the mode to go on in when the request offers a choice, then Reject
/// and Approve pinned under it, and Suggest Changes, which sends the person's note with the rejection.
struct PlanCard: View {
    let request: PlanApprovalRequest
    let isSending: Bool
    let send: (InteractionReply) -> Void
    @State private var modeAfter: String
    @State private var feedback = ""
    @State private var replying = false

    init(request: PlanApprovalRequest, isSending: Bool, send: @escaping (InteractionReply) -> Void) {
        self.request = request
        self.isSending = isSending
        self.send = send
        _modeAfter = State(initialValue: request.modeOptions?.defaultValue ?? request.modeOptions?.options.first?.value ?? "")
    }

    var body: some View {
        AskBody {
            FormattedText(text: request.plan)
            if let modes = request.modeOptions {
                Picker("Then", selection: $modeAfter) {
                    ForEach(modes.options, id: \.value) { Text($0.label).tag($0.value) }
                }
                .pickerStyle(.menu)
                .font(.subheadline)
            }
        } actions: {
            if replying {
                AskReplyBar(
                    placeholder: "What to change", text: $feedback, sendLabel: "Reject with this note",
                    cancel: { replying = false }, send: { send(PlanAnswer.reject(feedback: feedback)) })
            } else {
                VStack(spacing: Spacing.m) {
                    GlassEffectContainer(spacing: Spacing.s) {
                        HStack(spacing: Spacing.s) {
                            AskButton(title: "Reject", look: .destructive) { send(PlanAnswer.reject(feedback: "")) }
                            AskButton(title: "Approve Plan", look: .primary) { send(PlanAnswer.approve(request, modeAfter: modeAfter)) }
                        }
                    }
                    AskLinks { Button("Suggest Changes…") { replying = true } }
                }
            }
        }
        .disabled(isSending)
        .animation(.spring(duration: 0.28, bounce: 0.12), value: replying)
    }
}

/// What a plan card sends: an approval names the mode to go on in only when the plan offers modes; a
/// rejection carries the person's note, if any.
enum PlanAnswer {
    static func approve(_ request: PlanApprovalRequest, modeAfter: String) -> InteractionReply {
        .planApproval(PlanApprovalReply(
            decision: .approve, plan: nil, feedback: nil, modeAfter: request.modeOptions == nil ? nil : modeAfter))
    }

    static func reject(feedback: String) -> InteractionReply {
        .planApproval(PlanApprovalReply(
            decision: .reject, plan: nil, feedback: feedback.trimmed.isEmpty ? nil : feedback.trimmed, modeAfter: nil))
    }
}

enum DialogAnswer {
    /// A single-line answer holds no line break, which the contract refuses.
    static func text(_ text: String, for request: TextRequest) -> InteractionReply {
        .text(TextReply(text: request.multiline ? text : text.replacing("\n", with: " ")))
    }
}

/// A Pi dialog: pick one of its options, say yes or no, or type an answer.
struct DialogCard: View {
    let request: InteractionRequest
    let isSending: Bool
    let send: (InteractionReply) -> Void
    @State private var text = ""

    var body: some View {
        content
            .disabled(isSending)
            .onAppear {
                if case .text(let ask) = request, text.isEmpty { text = ask.initialText ?? "" }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch request {
        case .choice(let choice):
            AskBody {
                GlassEffectContainer(spacing: Spacing.s) {
                    VStack(spacing: Spacing.s) {
                        ForEach(choice.options, id: \.value) { option in
                            Button { send(.choice(ChoiceReply(value: option.value))) } label: {
                                VStack(spacing: Spacing.xxs) {
                                    Text(agentLine(option.label)).font(.body.weight(.semibold))
                                    if let description = option.description { FormattedMessage(text: description, role: .quiet) }
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.glass)
                            .controlSize(.large)
                        }
                    }
                }
            } actions: {
                EmptyView()
            }
        case .confirm(let ask):
            AskBody {
                if let url = ask.url.flatMap(URL.init(string:)) { LinkButton(url: url) }
            } actions: {
                GlassEffectContainer(spacing: Spacing.s) {
                    HStack(spacing: Spacing.s) {
                        AskButton(title: ask.url == nil ? "No" : "Decline") { send(.confirm(ConfirmReply(confirmed: false))) }
                        AskButton(title: ask.url == nil ? "Yes" : "Done", look: .primary) { send(.confirm(ConfirmReply(confirmed: true))) }
                    }
                }
            }
        case .text(let ask):
            AskBody {
                TextField(ask.placeholder ?? "Your answer", text: $text, axis: ask.multiline ? .vertical : .horizontal)
                    .lineLimit(ask.multiline ? 2...8 : 1...1)
                    .fieldBackground()
            } actions: {
                AskButton(title: "Send", look: .primary) { send(DialogAnswer.text(text, for: ask)) }
            }
        default:
            EmptyView()
        }
    }
}

/// The page to visit before answering, by its host, so the person sees where it goes before it opens.
private struct LinkButton: View {
    let url: URL
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button { openURL(url) } label: {
            Label("Open \(url.host() ?? url.absoluteString)", systemImage: "arrow.up.right.square")
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.glass)
    }
}
