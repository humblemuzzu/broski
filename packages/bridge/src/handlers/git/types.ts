import type { ServerMessage } from '../../types'

export type GitHandlerContext = {
  getSecurePath: (requestedPath: string) => Promise<string | null>
  safeString: (value: unknown) => string
}

export type GitReply = (response: ServerMessage) => void

export type RepoRef = {
  host: string
  owner: string
  repo: string
}

export type CommandResult = {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}
