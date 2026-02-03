import * as React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Command as CommandIcon } from "lucide-react"

import { useConnectionStore } from "@/stores/connection-store"
import { useOpenCodeStore } from "@/stores/opencode-store"
import { useProjectsStore } from "@/stores/projects-store"
import { useSessionsStore } from "@/stores/sessions-store"
import { useUiStore } from "@/stores/ui-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { Button } from "@/components/ui/button"

import { CommandPaletteInput } from "./CommandPaletteInput"
import { ActionsSection } from "./ActionsSection"
import { SlashCommandsSection } from "./SlashCommandsSection"

type ActionItem = {
  id: string
  label: string
  hint?: string
  run: () => void
}

function normalize(s: string) {
  return s.trim().toLowerCase()
}

export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen)
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen)

  const send = useConnectionStore((s) => s.send)
  const selectedProjectPath = useProjectsStore((s) => s.selectedProjectPath)
  const selectedSessionId = useSessionsStore((s) => s.selectedSessionId)
  const selectedSessionAgent = useSessionsStore((s) => s.selectedSessionAgent)

  const openPanel = useWorkspaceStore((s) => s.openPanel)
  const openChat = useWorkspaceStore((s) => s.openChat)

  const commandsByProject = useOpenCodeStore((s) => s.commandsByProject)
  const commands = commandsByProject[""] ?? []

  const [query, setQuery] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      const isCmdK = (e.metaKey || e.ctrlKey) && key === "k"
      if (isCmdK) {
        e.preventDefault()
        setOpen(true)
      }
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [setOpen])

  React.useEffect(() => {
    if (!open) return
    setQuery("")
    window.setTimeout(() => inputRef.current?.focus(), 0)
    // Best-effort refresh of OpenCode slash commands.
    send({ type: "list_commands", projectPath: selectedProjectPath ?? undefined } as any)
  }, [open, send, selectedProjectPath])

  const actions = React.useMemo(() => {
    const project = selectedProjectPath ?? ""
    const items: ActionItem[] = [
      {
        id: "open:dashboard",
        label: "Open Dashboard panel",
        run: () => openPanel("dashboard"),
      },
      {
        id: "open:terminal",
        label: "Open Terminal panel",
        hint: project ? project : "select a project",
        run: () => project && openPanel(`terminal:${project}`),
      },
      {
        id: "open:files",
        label: "Open Files panel",
        hint: project ? project : "select a project",
        run: () => project && openPanel(`files:${project}`),
      },
      {
        id: "open:git",
        label: "Open Git panel",
        hint: project ? project : "select a project",
        run: () => project && openPanel(`git:${project}`),
      },
      {
        id: "open:preview",
        label: "Open Preview panel",
        hint: project ? project : "select a project",
        run: () => project && openPanel(`browser:${project}`),
      },
      {
        id: "open:spec",
        label: "Open Spec panel",
        hint: project ? project : "select a project",
        run: () => project && openPanel(`spec:${project}`),
      },
      {
        id: "open:automation",
        label: "Open Automation panel",
        hint: project ? project : "select a project",
        run: () => project && openPanel(`automation:${project}`),
      },
      {
        id: "open:integrations",
        label: "Open Integrations panel",
        hint: project ? project : "select a project",
        run: () => project && openPanel(`integrations:${project}`),
      },
      {
        id: "open:chat",
        label: "Open Chat for selected session",
        hint: selectedSessionId ? `${selectedSessionAgent}:${selectedSessionId}` : "select a session",
        run: () => {
          if (!selectedSessionId || !selectedSessionAgent) return
          openChat(selectedSessionAgent, selectedSessionId)
        },
      },
    ]
    return items
  }, [openChat, openPanel, selectedProjectPath, selectedSessionAgent, selectedSessionId])

  const filteredActions = React.useMemo(() => {
    const q = normalize(query)
    if (!q) return actions
    return actions.filter((a) => normalize(a.label).includes(q))
  }, [actions, query])

  const filteredCommands = React.useMemo(() => {
    const q = normalize(query.startsWith("/") ? query.slice(1) : query)
    if (!q) return commands.slice(0, 20)
    return commands
      .filter((c) => normalize(c.name).includes(q) || normalize(c.description ?? "").includes(q))
      .slice(0, 30)
  }, [commands, query])

  const hint =
    selectedSessionAgent === "opencode" && selectedSessionId
      ? `Will run in session ${selectedSessionId}`
      : "Select an OpenCode session to run slash commands"

  const runCommand = React.useCallback(
    (name: string) => {
      if (!selectedSessionId) return
      if (selectedSessionAgent !== "opencode") return
      const raw = query.startsWith("/") ? query.slice(1) : query
      const args = raw.startsWith(name) ? raw.slice(name.length).trim() : ""
      send({
        type: "execute_command",
        sessionId: selectedSessionId,
        command: name,
        arguments: args,
        projectPath: selectedProjectPath ?? undefined,
      } as any)
    },
    [query, selectedProjectPath, selectedSessionAgent, selectedSessionId, send]
  )

  const handleSubmit = React.useCallback(() => {
    if (query.trim().length === 0) return

    // If input is "/cmd args", attempt to run best match.
    if (query.trim().startsWith("/")) {
      const first = query.trim().slice(1).split(/\s+/)[0] ?? ""
      if (first) {
        runCommand(first)
        setOpen(false)
        return
      }
    }

    // Otherwise run the first matching action.
    if (filteredActions[0]) {
      filteredActions[0].run()
      setOpen(false)
    }
  }, [query, filteredActions, runCommand, setOpen])

  const handleActionSelect = React.useCallback((action: ActionItem) => {
    action.run()
    setOpen(false)
  }, [setOpen])

  const handleCommandSelect = React.useCallback((command: any) => {
    runCommand(command.name)
    setOpen(false)
  }, [runCommand, setOpen])

  const canExecuteCommands = selectedSessionAgent === "opencode" && selectedSessionId

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-[18%] z-50 w-[680px] max-w-[92vw] -translate-x-1/2 rounded-xl border border-border bg-[var(--panel)] shadow-[var(--shadow-panel)]">
          <div className="flex items-center justify-between border-b border-[var(--panel-border)] bg-[var(--panel-header)] px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CommandIcon className="h-4 w-4 text-muted-foreground" />
              Command Palette
            </div>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>

          <CommandPaletteInput
            query={query}
            onQueryChange={setQuery}
            onSubmit={handleSubmit}
            inputRef={inputRef}
            hint={hint}
          />

          <div className="max-h-[55vh] overflow-auto border-t border-[var(--panel-border)] p-3">
            <ActionsSection
              actions={filteredActions}
              onSelect={handleActionSelect}
            />

            <SlashCommandsSection
              commands={filteredCommands}
              canExecute={!!canExecuteCommands}
              onCommandSelect={handleCommandSelect}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}