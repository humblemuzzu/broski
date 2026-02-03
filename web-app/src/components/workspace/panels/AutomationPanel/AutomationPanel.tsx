import * as React from "react"
import { RefreshCw, Wand2 } from "lucide-react"

import { useConnectionStore } from "@/stores/connection-store"
import { useProjectsStore } from "@/stores/projects-store"
import { useAutomationStore } from "@/stores/automation-store"
import { Button } from "@/components/ui/button"
import { BackendTabs } from "./BackendTabs"
import { KindTabs } from "./KindTabs"
import { AutomationControls } from "./AutomationControls"
import { AutomationList } from "./AutomationList"
import { AutomationDetail } from "./AutomationDetail"

type BackendTab = "opencode" | "claude-code" | "codex"
type KindTab = "skills" | "commands" | "agents" | "plugins" | "hooks"

function safeName(name: string) {
  return name.trim()
}

export function AutomationPanel({ projectPath }: { projectPath: string }) {
  const send = useConnectionStore((s) => s.send)
  const selectedProjectPath = useProjectsStore((s) => s.selectedProjectPath)
  const cwd = projectPath || selectedProjectPath || ""

  const [backend, setBackend] = React.useState<BackendTab>("opencode")
  const [kind, setKind] = React.useState<KindTab>("skills")
  const [newName, setNewName] = React.useState("")
  const [draft, setDraft] = React.useState("")
  const [selected, setSelected] = React.useState<{ name: string; meta?: any } | null>(null)

  // Store selectors
  const ocSkills = useAutomationStore((s) => s.ocSkills)
  const ocSkill = useAutomationStore((s) => s.ocSkill)
  const ocCommandFiles = useAutomationStore((s) => s.ocCommandFiles)
  const ocCommandFile = useAutomationStore((s) => s.ocCommandFile)
  const ocAgentFiles = useAutomationStore((s) => s.ocAgentFiles)
  const ocAgentFile = useAutomationStore((s) => s.ocAgentFile)
  const ocPluginFiles = useAutomationStore((s) => s.ocPluginFiles)
  const ocPluginFile = useAutomationStore((s) => s.ocPluginFile)

  const ccSkills = useAutomationStore((s) => s.ccSkills)
  const ccSkill = useAutomationStore((s) => s.ccSkill)
  const ccCommands = useAutomationStore((s) => s.ccCommands)
  const ccCommand = useAutomationStore((s) => s.ccCommand)
  const ccHooksFile = useAutomationStore((s) => s.ccHooksFile)

  const cxSkills = useAutomationStore((s) => s.cxSkills)
  const cxSkill = useAutomationStore((s) => s.cxSkill)

  const refresh = React.useCallback(() => {
    if (!cwd) return
    if (backend === "opencode") {
      if (kind === "skills") send({ type: "oc_list_skills", cwd } as any)
      if (kind === "commands") send({ type: "oc_list_command_files", cwd } as any)
      if (kind === "agents") send({ type: "oc_list_agent_files", cwd } as any)
      if (kind === "plugins") send({ type: "oc_list_plugin_files", cwd } as any)
    }
    if (backend === "claude-code") {
      if (kind === "skills") send({ type: "cc_list_skills", cwd } as any)
      if (kind === "commands") send({ type: "cc_list_commands", cwd } as any)
      if (kind === "hooks") send({ type: "cc_list_hooks", cwd } as any)
    }
    if (backend === "codex") {
      if (kind === "skills") send({ type: "cx_skills_list", cwd } as any)
    }
  }, [backend, cwd, kind, send])

  React.useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, kind, cwd])

  // Sync draft when selected item changes.
  React.useEffect(() => {
    if (!selected) return
    if (backend === "opencode") {
      if (kind === "skills") setDraft(ocSkill?.content ?? "")
      if (kind === "commands") setDraft(ocCommandFile?.content ?? "")
      if (kind === "agents") setDraft(ocAgentFile?.content ?? "")
      if (kind === "plugins") setDraft(ocPluginFile?.content ?? "")
    } else if (backend === "claude-code") {
      if (kind === "skills") setDraft(ccSkill?.content ?? "")
      if (kind === "commands") setDraft(ccCommand?.content ?? "")
      if (kind === "hooks") setDraft(ccHooksFile?.content ?? "")
    } else {
      setDraft(cxSkill?.content ?? "")
    }
  }, [
    backend,
    ccCommand?.content,
    ccHooksFile?.content,
    ccSkill?.content,
    cxSkill?.content,
    kind,
    ocAgentFile?.content,
    ocCommandFile?.content,
    ocPluginFile?.content,
    ocSkill?.content,
    selected,
  ])

  const listItems = React.useMemo(() => {
    if (backend === "opencode") {
      if (kind === "skills") return ocSkills.map((s) => ({ name: s.name, meta: s }))
      if (kind === "commands") return ocCommandFiles.map((s) => ({ name: s.name, meta: s }))
      if (kind === "agents") return ocAgentFiles.map((s) => ({ name: s.name, meta: s }))
      if (kind === "plugins") return ocPluginFiles.map((s) => ({ name: s.name, meta: s }))
      return []
    }
    if (backend === "claude-code") {
      if (kind === "skills") return ccSkills.map((s) => ({ name: s.name, meta: s }))
      if (kind === "commands") return ccCommands.map((s) => ({ name: s.name, meta: s }))
      if (kind === "hooks") return [{ name: "hooks.json", meta: { source: "project" } }]
      return []
    }
    // codex
    if (kind === "skills") return cxSkills.map((s) => ({ name: s.name, meta: s }))
    return []
  }, [
    backend,
    ccCommands,
    ccSkills,
    cxSkills,
    kind,
    ocAgentFiles,
    ocCommandFiles,
    ocPluginFiles,
    ocSkills,
  ])

  const openItem = (name: string, meta?: any) => {
    if (!cwd) return
    setSelected({ name, meta })

    if (backend === "opencode") {
      if (kind === "skills") send({ type: "oc_get_skill", name, source: meta?.source ?? "project", cwd } as any)
      if (kind === "commands") send({ type: "oc_get_command_file", name, source: meta?.source ?? "project", cwd } as any)
      if (kind === "agents") send({ type: "oc_get_agent_file", name, source: meta?.source ?? "project", cwd } as any)
      if (kind === "plugins") send({ type: "oc_get_plugin_file", name, source: meta?.source ?? "project", cwd } as any)
    } else if (backend === "claude-code") {
      if (kind === "skills") send({ type: "cc_get_skill", name, source: meta?.source ?? "project", cwd } as any)
      if (kind === "commands") send({ type: "cc_get_command", name, source: meta?.source ?? "project", cwd } as any)
      if (kind === "hooks") send({ type: "cc_hooks_file_read", source: "project", cwd } as any)
    } else {
      // codex
      if (kind === "skills") {
        const scope = meta?.scope ?? "Repo"
        send({ type: "cx_get_skill", name, scope, cwd } as any)
      }
    }
  }

  const save = () => {
    if (!cwd) return
    const name = selected?.name ? safeName(selected.name) : safeName(newName)
    if (!name) return

    if (backend === "opencode") {
      const source = selected?.meta?.source ?? "project"
      if (kind === "skills") send({ type: "oc_save_skill", name, source, content: draft, cwd } as any)
      if (kind === "commands") send({ type: "oc_save_command_file", name, source, content: draft, cwd } as any)
      if (kind === "agents") send({ type: "oc_save_agent_file", name, source, content: draft, cwd } as any)
      if (kind === "plugins") send({ type: "oc_save_plugin_file", name, source, content: draft, cwd } as any)
      refresh()
      return
    }

    if (backend === "claude-code") {
      const source = selected?.meta?.source ?? "project"
      if (kind === "skills") send({ type: "cc_save_skill", name, source, content: draft, cwd } as any)
      if (kind === "commands") send({ type: "cc_save_command", name, source, content: draft, cwd } as any)
      if (kind === "hooks") send({ type: "cc_hooks_file_write", source: "project", content: draft, cwd } as any)
      refresh()
      return
    }

    // codex
    const scope = selected?.meta?.scope ?? "Repo"
    send({ type: "cx_save_skill", name, scope, content: draft, cwd } as any)
    refresh()
  }

  const del = () => {
    if (!cwd) return
    if (!selected?.name) return
    const name = selected.name

    if (backend === "opencode") {
      const source = selected.meta?.source ?? "project"
      if (kind === "skills") send({ type: "oc_delete_skill", name, source, cwd } as any)
      if (kind === "commands") send({ type: "oc_delete_command_file", name, source, cwd } as any)
      if (kind === "agents") send({ type: "oc_delete_agent_file", name, source, cwd } as any)
      if (kind === "plugins") send({ type: "oc_delete_plugin_file", name, source, cwd } as any)
      setSelected(null)
      setDraft("")
      refresh()
      return
    }

    if (backend === "claude-code") {
      const source = selected.meta?.source ?? "project"
      if (kind === "skills") send({ type: "cc_delete_skill", name, source, cwd } as any)
      if (kind === "commands") send({ type: "cc_delete_command", name, source, cwd } as any)
      setSelected(null)
      setDraft("")
      refresh()
      return
    }

    // codex
    const scope = selected.meta?.scope ?? "Repo"
    send({ type: "cx_delete_skill", name, scope, cwd } as any)
    setSelected(null)
    setDraft("")
    refresh()
  }

  const kindOptions: KindTab[] =
    backend === "opencode"
      ? ["skills", "commands", "agents", "plugins"]
      : backend === "claude-code"
        ? ["skills", "commands", "hooks"]
        : ["skills"]

  const handleKindChange = (newKind: KindTab) => {
    setKind(newKind)
    setSelected(null)
    setDraft("")
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] bg-[var(--panel-header)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-semibold">Automation</div>
            <div className="mt-1 text-xs text-muted-foreground">{cwd}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={refresh} disabled={!cwd}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="border-b border-[var(--panel-border)] bg-[var(--panel-header)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <BackendTabs value={backend} onChange={setBackend} />
          <KindTabs kinds={kindOptions} value={kind} onChange={handleKindChange} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-[340px] shrink-0 border-r border-[var(--panel-border)]">
          <AutomationControls
            newName={newName}
            onNewNameChange={setNewName}
            onSave={save}
            onDelete={del}
            selectedName={selected?.name ?? null}
            kind={kind}
            backend={backend}
            disabled={!cwd}
          />
          <AutomationList
            items={listItems}
            selectedName={selected?.name ?? null}
            onSelect={openItem}
          />
        </div>

        <AutomationDetail
          selectedName={selected?.name ?? null}
          kind={kind}
          draft={draft}
          onDraftChange={setDraft}
        />
      </div>
    </div>
  )
}