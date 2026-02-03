/**
 * Bootstrap helpers for fetching initial data from all 3 backends.
 * 
 * The bridge supports 3 AI agent backends:
 * - OpenCode: list_projects, list_sessions
 * - Claude Code: cc_list_projects, cc_list_sessions
 * - Codex: cx_list_projects, cx_list_threads
 * 
 * This module provides centralized functions to request data from all backends,
 * ensuring consistent behavior across the app.
 */

import type { ClientMessage } from "@/core/types"

type SendFn = (msg: ClientMessage) => void

/**
 * Request project lists from all 3 backends.
 * Projects will be merged in projects-store via message-router.
 */
export function requestAllProjects(send: SendFn): void {
  // OpenCode projects
  send({ type: "list_projects" })
  // Claude Code projects (from ~/.claude/projects)
  send({ type: "cc_list_projects" } as ClientMessage)
  // Codex projects (derived from thread cwd values)
  send({ type: "cx_list_projects" } as ClientMessage)
}

/**
 * Request sessions/threads for a specific project from all 3 backends.
 * Sessions will be merged in sessions-store via message-router.
 */
export function requestAllSessionsForProject(send: SendFn, projectPath: string): void {
  // OpenCode sessions
  send({ type: "list_sessions", projectPath } as ClientMessage)
  // Claude Code sessions
  send({ type: "cc_list_sessions", cwd: projectPath } as ClientMessage)
  // Codex threads
  send({ type: "cx_list_threads", cwd: projectPath } as ClientMessage)
}

/**
 * Request global session lists (not filtered by project) from all 3 backends.
 */
export function requestAllSessions(send: SendFn): void {
  // Claude Code sessions (global)
  send({ type: "cc_list_sessions" } as ClientMessage)
  // Codex threads (global)
  send({ type: "cx_list_threads" } as ClientMessage)
}

/**
 * Bootstrap all initial data needed after connection.
 * Called once when WebSocket connection is established.
 * 
 * @param send - WebSocket send function
 * @param selectedProjectPath - Previously selected project path (from localStorage)
 */
export function bootstrapInitialData(send: SendFn, selectedProjectPath?: string | null): void {
  // Request projects from all backends
  requestAllProjects(send)
  
  // Request global session lists (unfiltered)
  requestAllSessions(send)
  
  // If a project was previously selected, load its sessions too
  if (selectedProjectPath) {
    requestAllSessionsForProject(send, selectedProjectPath)
  }
  
  // Request device list
  send({ type: "list_devices" } as ClientMessage)
  
  // Request pending permissions and questions
  send({ type: "list_pending_permissions" } as ClientMessage)
  send({ type: "list_pending_questions" } as ClientMessage)
}
