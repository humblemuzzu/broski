import type { GlobalSession, OpencodeClient, Session } from '@opencode-ai/sdk/v2'
import type { SessionSummary } from '../../types'

export type OpenCodeSessionListOptions = {
  roots?: boolean
  start?: number
  cursor?: number
  search?: string
  limit?: number
  archived?: boolean
}

type SessionCache = Map<string, { data: SessionSummary[]; fetchedAt: number }>

export async function listOpenCodeSessionsWithCache(args: {
  directory?: string
  options?: OpenCodeSessionListOptions
  sessionCache: SessionCache
  cacheTtlMs: number
  listSessionsInternal: (
    directory?: string,
    options?: OpenCodeSessionListOptions,
  ) => Promise<SessionSummary[]>
}): Promise<SessionSummary[]> {
  const { directory, options, sessionCache, cacheTtlMs, listSessionsInternal } = args

  const hasFilters =
    options?.roots !== undefined ||
    options?.start !== undefined ||
    options?.cursor !== undefined ||
    ((options?.search?.trim().length ?? 0) > 0) ||
    options?.limit !== undefined ||
    options?.archived !== undefined

  // Avoid stale cache for filtered/paginated queries.
  if (hasFilters) {
    return listSessionsInternal(directory, options)
  }

  const cacheKey = directory ?? '__all__'
  const now = Date.now()
  const cached = sessionCache.get(cacheKey)

  if (cached && now - cached.fetchedAt < cacheTtlMs) {
    return cached.data
  }

  const result = await listSessionsInternal(directory, options)
  sessionCache.set(cacheKey, { data: result, fetchedAt: now })
  return result
}

export async function listOpenCodeSessionsInternal(args: {
  client: OpencodeClient
  directory?: string
  options?: OpenCodeSessionListOptions
  mapSession: (session: Session) => SessionSummary
}): Promise<SessionSummary[]> {
  const { client, directory, options, mapSession } = args

  if (directory != null && directory.length > 0) {
    // session.list does not support cursor/archived; use experimental when needed.
    if (options?.cursor !== undefined || options?.archived !== undefined) {
      const sessions =
        (await client.experimental.session.list(
          {
            directory,
            ...(options?.roots !== undefined ? { roots: options.roots } : {}),
            ...(options?.start !== undefined ? { start: options.start } : {}),
            ...(options?.cursor !== undefined ? { cursor: options.cursor } : {}),
            ...(options?.search ? { search: options.search } : {}),
            ...(options?.limit !== undefined ? { limit: options.limit } : {}),
            ...(options?.archived !== undefined ? { archived: options.archived } : {}),
          },
          { responseStyle: 'data' },
        )) ?? []
      return sessions.map(mapGlobalSession)
    }

    const sessions =
      (await client.session.list(
        {
          directory,
          ...(options?.roots !== undefined ? { roots: options.roots } : {}),
          ...(options?.start !== undefined ? { start: options.start } : {}),
          ...(options?.search ? { search: options.search } : {}),
          ...(options?.limit !== undefined ? { limit: options.limit } : {}),
        },
        { responseStyle: 'data' },
      )) ?? []
    return sessions.map((session) => mapSession(session))
  }

  const sessions =
    (await client.experimental.session.list(
      {
        ...(options?.roots !== undefined ? { roots: options.roots } : {}),
        ...(options?.start !== undefined ? { start: options.start } : {}),
        ...(options?.cursor !== undefined ? { cursor: options.cursor } : {}),
        ...(options?.search ? { search: options.search } : {}),
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
        ...(options?.archived !== undefined ? { archived: options.archived } : {}),
      },
      { responseStyle: 'data' },
    )) ?? []

  return sessions
    .map(mapGlobalSession)
    .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
}

function mapGlobalSession(session: GlobalSession): SessionSummary {
  return {
    id: session.id,
    slug: session.slug || undefined,
    title: session.title,
    projectID: session.projectID,
    directory: session.directory,
    parentID: session.parentID,
    time: session.time,
    summary: session.summary,
    share: session.share,
    revert: session.revert ?? undefined,
    permission: session.permission ?? undefined,
    project: session.project
      ? {
          id: session.project.id,
          name: session.project.name,
          worktree: session.project.worktree,
        }
      : undefined,
  }
}
