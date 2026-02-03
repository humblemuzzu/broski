import * as React from "react"
import { QuestionCard } from "./QuestionCard"

interface PendingQuestionsProps {
  questions: any[]
  answers: Record<string, string>
  onAnswerChange: (questionId: string, answer: string) => void
  onSend: (message: any) => void
}

export const PendingQuestions = React.memo<PendingQuestionsProps>(function PendingQuestions({
  questions,
  answers,
  onAnswerChange,
  onSend,
}) {
  if (!questions || questions.length === 0) {
    return null
  }

  return (
    <div className="mb-3 rounded-lg border border-border bg-[var(--panel)] p-3">
      <div className="text-xs font-semibold text-muted-foreground">
        Pending Questions ({questions.length})
      </div>
      <div className="mt-3 space-y-2">
        {questions.slice(0, 5).map((q: any, idx: number) => {
          const questionId =
            (typeof q?.id === "string" && q.id) ||
            (typeof q?.questionId === "string" && q.questionId) ||
            (typeof q?.questionID === "string" && q.questionID) ||
            ""
          const current = questionId ? answers[questionId] ?? "" : ""
          
          return (
            <QuestionCard
              key={`${questionId || "q"}:${idx}`}
              question={q}
              answer={current}
              onAnswerChange={(value) => {
                if (questionId) {
                  onAnswerChange(questionId, value)
                }
              }}
              onSend={onSend}
            />
          )
        })}
      </div>
    </div>
  )
})