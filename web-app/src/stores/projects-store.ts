import { create } from "zustand"
import { persist } from "zustand/middleware"

import { STORAGE_KEYS } from "@/core/constants"
import type { AgentType, ProjectSummary } from "@/core/types"

/**
 * Source backend for a project - tracks which backends have sessions in this project.
 */
type ProjectSource = "opencode" | "claude-code" | "codex"

/**
 * Extended project info with source tracking.
 */
type ProjectWithSources = ProjectSummary & {
  sources: Set<ProjectSource>
}

type ProjectsState = {
  /** All projects merged from all backends, deduplicated by path */
  projects: ProjectSummary[]
  /** Internal map for tracking which backends reported each project */
  _projectsByPath: Map<string, ProjectWithSources>
  /** Currently selected project path */
  selectedProjectPath: string | null
  /** Loading state per backend */
  loadingBackends: Set<ProjectSource>

  /**
   * Merge projects from a specific backend into the unified list.
   * Projects are deduplicated by path; metadata is merged (latest wins).
   */
  mergeProjects: (source: ProjectSource, projects: ProjectSummary[]) => void

  /**
   * Legacy setter - replaces all projects (used when source is unknown).
   * @deprecated Use mergeProjects instead for proper multi-backend support.
   */
  setProjects: (projects: ProjectSummary[]) => void

  /** Clear all projects from a specific backend */
  clearBackendProjects: (source: ProjectSource) => void

  /** Select a project by path */
  selectProject: (projectPath: string | null) => void

  /** Set loading state for a backend */
  setBackendLoading: (source: ProjectSource, loading: boolean) => void

  /** Check if any backend is loading */
  isLoading: () => boolean
}

function projectsMapToArray(map: Map<string, ProjectWithSources>): ProjectSummary[] {
  const projects = Array.from(map.values()).map((p) => {
    // Strip internal sources field for external use
    const { sources: _sources, ...project } = p
    return project as ProjectSummary
  })
  // Sort by lastOpened (most recent first), then by name
  projects.sort((a, b) => {
    const aTime = a.lastOpened ?? 0
    const bTime = b.lastOpened ?? 0
    if (aTime !== bTime) return bTime - aTime
    return (a.name ?? "").localeCompare(b.name ?? "")
  })
  return projects
}

export const useProjectsStore = create<ProjectsState>()(
  persist(
    (set, get) => ({
      projects: [],
      _projectsByPath: new Map(),
      selectedProjectPath: null,
      loadingBackends: new Set(),

      mergeProjects: (source, newProjects) => {
        set((state) => {
          const map = new Map(state._projectsByPath)

          for (const project of newProjects) {
            if (!project.path) continue
            const existing = map.get(project.path)
            if (existing) {
              // Merge: update metadata, add source
              existing.sources.add(source)
              // Update fields if newer data available
              if (project.lastOpened && (!existing.lastOpened || project.lastOpened > existing.lastOpened)) {
                existing.lastOpened = project.lastOpened
              }
              if (project.name) existing.name = project.name
            } else {
              // New project
              map.set(project.path, {
                ...project,
                sources: new Set([source]),
              })
            }
          }

          return {
            _projectsByPath: map,
            projects: projectsMapToArray(map),
          }
        })
      },

      setProjects: (projects) => {
        // Legacy behavior: infer source from context or treat as opencode
        // This maintains backward compatibility with existing code
        get().mergeProjects("opencode", projects)
      },

      clearBackendProjects: (source) => {
        set((state) => {
          const map = new Map(state._projectsByPath)
          for (const [path, project] of map) {
            project.sources.delete(source)
            // If no sources remain, remove the project entirely
            if (project.sources.size === 0) {
              map.delete(path)
            }
          }
          return {
            _projectsByPath: map,
            projects: projectsMapToArray(map),
          }
        })
      },

      selectProject: (projectPath) => set({ selectedProjectPath: projectPath }),

      setBackendLoading: (source, loading) => {
        set((state) => {
          const newSet = new Set(state.loadingBackends)
          if (loading) {
            newSet.add(source)
          } else {
            newSet.delete(source)
          }
          return { loadingBackends: newSet }
        })
      },

      isLoading: () => get().loadingBackends.size > 0,
    }),
    {
      name: STORAGE_KEYS.selectedProject,
      partialize: (state) => ({
        // Only persist selection, not the full project list
        selectedProjectPath: state.selectedProjectPath,
      }),
    }
  )
)

/**
 * Helper to get projects that have sessions in a specific backend.
 */
export function getProjectsForBackend(backend: AgentType): ProjectSummary[] {
  const state = useProjectsStore.getState()
  const sourceKey = backend as ProjectSource
  return Array.from(state._projectsByPath.values())
    .filter((p) => p.sources.has(sourceKey))
    .map(({ sources: _s, ...p }) => p as ProjectSummary)
}

