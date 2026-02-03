import * as React from "react"

import { useConnectionStore } from "@/stores/connection-store"
import { useGitStore } from "@/stores/git-store"

import { GitHeader } from "./GitHeader"
import { BranchCard } from "./BranchCard"
import { WorktreeSection } from "./WorktreeSection"
import { ChangesSection } from "./ChangesSection"
import { DiffViewer } from "./DiffViewer"

export function GitPanel({ projectPath }: { projectPath: string }) {
  const send = useConnectionStore((s) => s.send)
  const vcs = useGitStore((s) => s.vcs)
  const fileStatus = useGitStore((s) => s.fileStatus)
  const worktrees = useGitStore((s) => s.worktrees)
  const selectedPath = useGitStore((s) => s.selectedPath)
  const setSelectedPath = useGitStore((s) => s.setSelectedPath)
  const diffByPath = useGitStore((s) => s.diffByPath)

  const [staged, setStaged] = React.useState(false)
  const [newWorktreeName, setNewWorktreeName] = React.useState("")

  React.useEffect(() => {
    send({ type: "get_vcs", projectPath } as any)
    send({ type: "get_file_status", projectPath } as any)
    send({ type: "list_worktrees", projectPath } as any)
  }, [projectPath, send])

  const diffKey = (selectedPath ?? "__repo__") as string
  const diff = diffByPath[diffKey]?.diff ?? ""

  const handleRefresh = React.useCallback(() => {
    send({ type: "get_vcs", projectPath } as any)
    send({ type: "get_file_status", projectPath } as any)
    send({ type: "list_worktrees", projectPath } as any)
  }, [projectPath, send])

  const handleCreateWorktree = React.useCallback(() => {
    const name = newWorktreeName.trim()
    if (!name) return
    send({ type: "create_worktree", name, projectPath } as any)
    setNewWorktreeName("")
  }, [newWorktreeName, projectPath, send])

  const handleDeleteWorktree = React.useCallback((name: string) => {
    send({ type: "delete_worktree", name, projectPath } as any)
  }, [projectPath, send])

  const handleFileSelect = React.useCallback((path: string) => {
    setSelectedPath(path)
    send({ type: "git_diff", projectPath, path, staged } as any)
  }, [projectPath, send, setSelectedPath, staged])

  const handleRepoDiff = React.useCallback(() => {
    setSelectedPath(null)
    send({ type: "git_diff", projectPath, staged } as any)
  }, [projectPath, send, setSelectedPath, staged])

  const handleStagedChange = React.useCallback((nextStaged: boolean) => {
    setStaged(nextStaged)
    send({
      type: "git_diff",
      projectPath,
      path: selectedPath ?? undefined,
      staged: nextStaged,
    } as any)
  }, [projectPath, selectedPath, send])

  const handleWorktreeRefresh = React.useCallback(() => {
    send({ type: "list_worktrees", projectPath } as any)
  }, [projectPath, send])

  return (
    <div className="flex h-full flex-col">
      <GitHeader projectPath={projectPath} onRefresh={handleRefresh} />

      <div className="flex min-h-0 flex-1">
        <div className="w-[360px] shrink-0 overflow-auto border-r border-[var(--panel-border)] p-3">
          <BranchCard 
            branch={vcs?.branch ?? "—"} 
          />

          <WorktreeSection
            worktrees={worktrees}
            newWorktreeName={newWorktreeName}
            onNewWorktreeNameChange={setNewWorktreeName}
            onCreateWorktree={handleCreateWorktree}
            onDeleteWorktree={handleDeleteWorktree}
            onRefresh={handleWorktreeRefresh}
          />

          <ChangesSection
            fileStatus={fileStatus}
            selectedPath={selectedPath}
            onFileSelect={handleFileSelect}
            onRepoDiff={handleRepoDiff}
          />
        </div>

        <div className="min-w-0 flex-1 overflow-auto p-3">
          <DiffViewer
            diff={diff}
            selectedPath={selectedPath}
            staged={staged}
            onStagedChange={handleStagedChange}
          />
        </div>
      </div>
    </div>
  )
}