import React from "react"

interface SessionItemProps {
  session: { id: string; title: string; agentType: string };
  isSelected: boolean;
  onSelect: () => void;
}

export const SessionItem = React.memo<SessionItemProps>(({ session, isSelected, onSelect }) => {
  return (
    <button
      className={[
        "w-full rounded-md px-2 py-2 text-left text-sm transition-colors",
        isSelected
          ? "bg-[var(--sidebar-item-active)]"
          : "hover:bg-[var(--sidebar-item-hover)]",
      ].join(" ")}
      onClick={onSelect}
    >
      <div className="truncate">{session.title}</div>
      <div className="truncate text-xs text-muted-foreground">
        {session.agentType}
      </div>
    </button>
  )
})

SessionItem.displayName = "SessionItem"