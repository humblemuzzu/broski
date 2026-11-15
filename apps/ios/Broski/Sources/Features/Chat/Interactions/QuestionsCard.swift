import BroskiCore
import SwiftUI

/// Questions the agent asks: one tab per question when there are several, the options to pick one
/// or any of, the person's own answer where allowed (masked when secret), and Send once every
/// required question has an answer.
struct QuestionsCard: View {
    let request: QuestionsRequest
    let isSending: Bool
    let send: (InteractionReply) -> Void
    @State private var draft = QuestionsDraft()
    @State private var tab = 0

    private var question: Question { request.questions[min(tab, request.questions.count - 1)] }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            if request.questions.count > 1 {
                Picker("Question", selection: $tab) {
                    ForEach(request.questions.indices, id: \.self) { index in
                        Text(request.questions[index].header ?? "Question \(index + 1)").tag(index)
                    }
                }
                .pickerStyle(.segmented)
            }
            QuestionView(question: question, draft: $draft)
                .id(question.id)
            Button {
                send(draft.reply(request))
            } label: {
                Text(request.questions.count > 1 ? "Send Answers" : "Send Answer")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(isSending || !draft.isComplete(request))
        }
    }
}

private struct QuestionView: View {
    let question: Question
    @Binding var draft: QuestionsDraft

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Text(question.text).font(.headline)
            if !question.options.isEmpty {
                Text(question.multiSelect ? "Pick any" : "Pick one")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                ForEach(question.options, id: \.label) { option in
                    optionRow(option)
                }
            }
            if question.allowCustom {
                customField
            }
        }
    }

    private func optionRow(_ option: QuestionOption) -> some View {
        let picked = draft.isSelected(option.label, in: question)
        return Button {
            draft.toggle(option.label, in: question)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                Image(systemName: symbol(picked: picked))
                    .foregroundStyle(picked ? Palette.accent : .secondary)
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(option.label).font(.subheadline.weight(.medium))
                    if let description = option.description {
                        Text(description).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, Spacing.xs)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(picked ? .isSelected : [])
    }

    private func symbol(picked: Bool) -> String {
        if question.multiSelect { return picked ? "checkmark.square.fill" : "square" }
        return picked ? "largecircle.fill.circle" : "circle"
    }

    @ViewBuilder
    private var customField: some View {
        let text = Binding { draft.customText(question) } set: { draft.setCustom($0, in: question) }
        let prompt = question.options.isEmpty ? "Your answer" : "Something else"
        Group {
            if question.secret {
                SecureField(prompt, text: text)
            } else {
                TextField(prompt, text: text, axis: .vertical).lineLimit(1...4)
            }
        }
        .font(.subheadline)
        .padding(.horizontal, Spacing.m)
        .padding(.vertical, Spacing.s)
        .background(Color(uiColor: .tertiarySystemFill), in: .rect(cornerRadius: 14, style: .continuous))
    }
}
