import * as React from "react"
import { ContextCard } from "./ContextCard"
import { OpenCodeConfig } from "./OpenCodeConfig"
import { ClaudeCodeConfig } from "./ClaudeCodeConfig"
import { CodexConfig } from "./CodexConfig"

interface ConfigModeProps {
  projectPath: string | null
  sessionAgent: string | null
  sessionId: string | null
  openCodeModel: string
  onOpenCodeModelChange: (model: string) => void
  claudeModel: string
  onClaudeModelChange: (model: string) => void
  codexModel: string
  onCodexModelChange: (model: string) => void
  onSend: (message: any) => void
  ocProviders: any
  ocConfig: any
  ccConfig: any
  ccSkills: any
  cxModels: any
  cxConfig: any
  cxSkills: any
  claudeMcpFile: { path: string; content: string } | null
  codexMcpStatus: any
  claudeMcpDraft: string
  onClaudeMcpDraftChange: (content: string) => void
}

export const ConfigMode = React.memo<ConfigModeProps>(function ConfigMode({
  projectPath,
  sessionAgent,
  sessionId,
  openCodeModel,
  onOpenCodeModelChange,
  claudeModel,
  onClaudeModelChange,
  codexModel,
  onCodexModelChange,
  onSend,
  ocProviders,
  ocConfig,
  ccConfig,
  ccSkills,
  cxModels,
  cxConfig,
  cxSkills,
  claudeMcpFile,
  codexMcpStatus,
  claudeMcpDraft,
  onClaudeMcpDraftChange,
}) {
  return (
    <div className="space-y-3">
      <ContextCard
        projectPath={projectPath}
        sessionAgent={sessionAgent}
        sessionId={sessionId}
      />

      <OpenCodeConfig
        projectPath={projectPath}
        openCodeModel={openCodeModel}
        onModelChange={onOpenCodeModelChange}
        onSend={onSend}
        providers={ocProviders}
        config={ocConfig}
      />

      <ClaudeCodeConfig
        projectPath={projectPath}
        claudeModel={claudeModel}
        onModelChange={onClaudeModelChange}
        onSend={onSend}
        config={ccConfig}
        skills={ccSkills}
        mcpFile={claudeMcpFile}
        mcpDraft={claudeMcpDraft}
        onMcpDraftChange={onClaudeMcpDraftChange}
      />

      <CodexConfig
        projectPath={projectPath}
        codexModel={codexModel}
        onModelChange={onCodexModelChange}
        onSend={onSend}
        models={cxModels}
        config={cxConfig}
        skills={cxSkills}
        mcpStatus={codexMcpStatus}
      />
    </div>
  )
})