import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface Question {
  id?: string
  questionId?: string
  questionID?: string
  prompt?: string
  question?: string
  options?: any[]
  choices?: any[]
}

interface QuestionCardProps {
  question: Question
  answer: string
  onAnswerChange: (value: string) => void
  onSend: (message: any) => void
}

export const QuestionCard = React.memo<QuestionCardProps>(function QuestionCard({
  question,
  answer,
  onAnswerChange,
  onSend,
}) {
  const questionId =
    (typeof question?.id === "string" && question.id) ||
    (typeof question?.questionId === "string" && question.questionId) ||
    (typeof question?.questionID === "string" && question.questionID) ||
    ""

  const prompt = question?.prompt ?? question?.question ?? "question"

  const optionsRaw =
    Array.isArray(question?.options)
      ? question.options
      : Array.isArray(question?.choices)
        ? question.choices
        : []

  const options = optionsRaw
    .map((o: any) =>
      typeof o === "string"
        ? { label: o }
        : typeof o?.label === "string"
          ? { label: o.label }
          : null
    )
    .filter(Boolean) as Array<{ label: string }>

  const handleSubmit = () => {
    if (!questionId) return
    const trimmedAnswer = answer.trim()
    if (!trimmedAnswer) return
    onSend({
      type: "oc_question_reply",
      questionId,
      answers: [[trimmedAnswer]],
    })
  }

  const handleReject = () => {
    if (!questionId) return
    onSend({ type: "oc_question_reject", questionId })
  }

  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div className="text-xs font-semibold">{String(prompt)}</div>
      {questionId ? (
        <div className="mt-1 text-[11px] text-muted-foreground">
          id: {questionId}
        </div>
      ) : null}

      {options.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {options.slice(0, 8).map((o) => (
            <Button
              key={o.label}
              size="sm"
              variant="outline"
              onClick={() => onAnswerChange(o.label)}
            >
              {o.label}
            </Button>
          ))}
        </div>
      ) : null}

      {questionId ? (
        <div className="mt-2 flex items-center gap-2">
          <Input
            value={answer}
            onChange={(e) => onAnswerChange(e.target.value)}
            placeholder="Answer…"
          />
          <Button size="sm" onClick={handleSubmit}>
            Reply
          </Button>
          <Button size="sm" variant="outline" onClick={handleReject}>
            Reject
          </Button>
        </div>
      ) : (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            Details
          </summary>
          <pre className="mt-2 max-h-[240px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
            {JSON.stringify(question, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
})