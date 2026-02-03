import { Plus, MessageSquare } from "lucide-react"
import { SessionItem } from "./SessionItem"

interface SessionListProps {
  sessions: Array<{ id: string; title: string; agentType: string }>
  selectedId: string | null
  onSelectSession: (id: string, agent: string) => void
  onCreateSession: () => void
}

export function SessionList({ 
  sessions, 
  selectedId, 
  onSelectSession, 
  onCreateSession 
}: SessionListProps) {
  return (
    <div className="py-1 mt-2">
      {/* Section header */}
      <div className="flex items-center justify-between px-2 py-1.5 mb-1">
        <span className="text-[11px] font-medium text-[var(--text-faint)] uppercase tracking-wider">
          Sessions
        </span>
        <button
          onClick={onCreateSession}
          className="p-1 rounded text-[var(--text-faint)] hover:text-[var(--accent)] 
                     hover:bg-[var(--accent-soft)] transition-all"
          aria-label="New session"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {/* Session list */}
      <div className="space-y-0.5">
        {sessions.length === 0 ? (
          <div className="flex items-center gap-2 px-2 py-3 text-[var(--text-faint)]">
            <MessageSquare className="h-4 w-4" />
            <span className="text-xs">No sessions</span>
          </div>
        ) : (
          sessions.map((session) => (
            <SessionItem
              key={`${session.agentType}:${session.id}`}
              session={session}
              isSelected={selectedId === session.id}
              onSelect={() => onSelectSession(session.id, session.agentType)}
            />
          ))
        )}
      </div>
    </div>
  )
}
