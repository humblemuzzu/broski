import BroskiCore

/// The person's answers to a `questions` ask as they pick them: option labels per question, and
/// their own words where a question takes them. A single-choice question holds one option or one
/// custom answer, never both.
struct QuestionsDraft: Equatable {
    private(set) var selected: [String: [String]] = [:]
    private(set) var custom: [String: String] = [:]

    mutating func toggle(_ label: String, in question: Question) {
        var labels = selected[question.id] ?? []
        if question.multiSelect {
            if let index = labels.firstIndex(of: label) { labels.remove(at: index) } else { labels.append(label) }
        } else {
            labels = labels == [label] ? [] : [label]
            custom[question.id] = nil
        }
        selected[question.id] = labels
    }

    mutating func setCustom(_ text: String, in question: Question) {
        custom[question.id] = text
        if !question.multiSelect && !text.trimmed.isEmpty { selected[question.id] = [] }
    }

    func isSelected(_ label: String, in question: Question) -> Bool {
        selected[question.id]?.contains(label) ?? false
    }

    func customText(_ question: Question) -> String { custom[question.id] ?? "" }

    func isAnswered(_ question: Question) -> Bool {
        !(selected[question.id] ?? []).isEmpty || (question.allowCustom && !customText(question).trimmed.isEmpty)
    }

    /// Every required question has an answer.
    func isComplete(_ request: QuestionsRequest) -> Bool {
        request.questions.allSatisfy { !$0.required || isAnswered($0) }
    }

    /// One answer per answered question, its options in the order the question lists them.
    func reply(_ request: QuestionsRequest) -> InteractionReply {
        let answers = request.questions.filter(isAnswered).map { question in
            let picked = Set(selected[question.id] ?? [])
            let words = customText(question).trimmed
            return QuestionAnswer(
                questionId: question.id,
                selected: question.options.map(\.label).filter(picked.contains),
                custom: question.allowCustom && !words.isEmpty ? words : nil)
        }
        return .questions(QuestionsReply(answers: answers))
    }
}
