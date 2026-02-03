interface AgentSelectorProps {
  value: "claude-code" | "codex" | "opencode";
  onChange: (agent: "claude-code" | "codex" | "opencode") => void;
}

export function AgentSelector({ value, onChange }: AgentSelectorProps) {
  return (
    <div className="border-t border-[var(--sidebar-border)] px-3 py-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">Agent</div>
        <select
          className="h-8 rounded-md border border-border bg-transparent px-2 text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value as "claude-code" | "codex" | "opencode")}
        >
          <option value="claude-code">Claude Code</option>
          <option value="codex">Codex</option>
          <option value="opencode">OpenCode</option>
        </select>
      </div>
    </div>
  )
}