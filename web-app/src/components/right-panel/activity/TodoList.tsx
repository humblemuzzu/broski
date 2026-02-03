import * as React from "react"

interface TodoItem {
  id: string
  content: string
  status: string
  priority: string
}

interface TodoListProps {
  todos: TodoItem[]
}

export const TodoList = React.memo<TodoListProps>(function TodoList({
  todos,
}) {
  if (!todos || todos.length === 0) {
    return null
  }

  return (
    <div className="mt-3 space-y-2">
      {todos.slice(0, 20).map((t) => (
        <div
          key={t.id}
          className="rounded-md border border-border bg-card p-2"
        >
          <div className="text-xs font-semibold">{t.content}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {t.status} · {t.priority}
          </div>
        </div>
      ))}
    </div>
  )
})