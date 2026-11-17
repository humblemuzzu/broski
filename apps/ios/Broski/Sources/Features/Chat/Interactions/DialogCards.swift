import BroskiCore
import SwiftUI

/// A plan to approve: the plan, the mode to go on in when the request offers a choice,
/// Approve, and Reject with a note for the agent.
struct PlanCard: View {
    let request: PlanApprovalRequest
    let isSending: Bool
    let send: (InteractionReply) -> Void
    @State private var modeAfter: String
    @State private var feedback = ""

    init(request: PlanApprovalRequest, isSending: Bool, send: @escaping (InteractionReply) -> Void) {
        self.request = request
        self.isSending = isSending
        self.send = send
        _modeAfter = State(initialValue: request.modeOptions?.defaultValue ?? request.modeOptions?.options.first?.value ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            ScrollView {
                FormattedText(text: request.plan)
            }
            .frame(maxHeight: 260)
            .fixedSize(horizontal: false, vertical: true)
            if let modes = request.modeOptions {
                Picker("Then", selection: $modeAfter) {
                    ForEach(modes.options, id: \.value) { Text($0.label).tag($0.value) }
                }
                .pickerStyle(.menu)
                .font(.subheadline)
            }
            GlassEffectContainer(spacing: Spacing.s) {
                VStack(spacing: Spacing.s) {
                    Button {
                        send(PlanAnswer.approve(request, modeAfter: modeAfter))
                    } label: {
                        Text("Approve Plan").font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                    HStack(spacing: Spacing.s) {
                        TextField("What to change", text: $feedback, axis: .vertical).lineLimit(1...3).fieldBackground()
                        Button {
                            send(PlanAnswer.reject(feedback: feedback))
                        } label: {
                            Text("Reject").font(.subheadline.weight(.semibold))
                        }
                        .buttonStyle(.glass)
                        .tint(Palette.failed)
                    }
                }
            }
            .controlSize(.large)
            .disabled(isSending)
        }
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
        GlassEffectContainer(spacing: Spacing.s) {
            content
        }
        .controlSize(.large)
        .disabled(isSending)
        .onAppear {
            if case .text(let ask) = request, text.isEmpty { text = ask.initialText ?? "" }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch request {
        case .choice(let choice):
            VStack(spacing: Spacing.s) {
                ForEach(choice.options, id: \.value) { option in
                    Button { send(.choice(ChoiceReply(value: option.value))) } label: {
                        VStack(spacing: Spacing.xxs) {
                            Text(option.label).font(.subheadline.weight(.semibold))
                            if let description = option.description { Text(description).font(.caption) }
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass)
                }
            }
        case .confirm(let ask):
            VStack(spacing: Spacing.s) {
                if let url = ask.url.flatMap(URL.init(string:)) { LinkButton(url: url) }
                HStack(spacing: Spacing.s) {
                    Button { send(.confirm(ConfirmReply(confirmed: false))) } label: {
                        Text(ask.url == nil ? "No" : "Decline").font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass)
                    Button { send(.confirm(ConfirmReply(confirmed: true))) } label: {
                        Text(ask.url == nil ? "Yes" : "Done").font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                }
            }
        case .text(let ask):
            VStack(spacing: Spacing.s) {
                TextField(ask.placeholder ?? "Your answer", text: $text, axis: ask.multiline ? .vertical : .horizontal)
                    .lineLimit(ask.multiline ? 2...8 : 1...1)
                    .fieldBackground()
                Button { send(DialogAnswer.text(text, for: ask)) } label: {
                    Text("Send").font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
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
