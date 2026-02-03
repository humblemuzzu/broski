import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SessionItem } from "./SessionItem"

interface SessionListProps {
  sessions: Array<{ id: string; title: string; agentType: string }>;
  selectedId: string | null;
  onSelectSession: (id: string, agent: string) => void;
  onCreateSession: () => void;
}

export function SessionList({ sessions, selectedId, onSelectSession, onCreateSession }: SessionListProps) {
  return (
    <div className="px-1 py-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold text-muted-foreground">
          Sessions
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="New session"
          onClick={onCreateSession}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-1">
        {sessions.map((session) => (
          <SessionItem
            key={`${session.agentType}:${session.id}`}
            session={session}
            isSelected={selectedId === session.id}
            onSelect={() => onSelectSession(session.id, session.agentType)}
          />
        ))}
      </div>
    </div>
  )
}