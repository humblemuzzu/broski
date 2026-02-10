import {
  getGithubPrDiff,
  listGithubIssues,
  listGithubPrComments,
  listGithubPrs,
  resolveRepoRef,
} from './github'
import { normalizeGithubState } from './parse'
import type { GitHandlerContext, GitReply } from './types'
import { ensureSecureCwd, errorReply } from './util'

export async function handleGithubCommand(
  message: any,
  reply: GitReply,
  ctx: GitHandlerContext,
): Promise<boolean> {
  const requestId =
    typeof message?.requestId === 'string' ? message.requestId : undefined

  switch (message.type) {
    case 'github_remote': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const repo = await resolveRepoRef(secureCwd)
      reply({
        type: 'github_remote_result',
        data: repo
          ? { owner: repo.owner, repo: repo.repo, host: repo.host }
          : null,
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'github_issues': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const repo = await resolveRepoRef(secureCwd)
      if (!repo) {
        reply({
          type: 'github_issues_result',
          data: [],
          ...(requestId ? { requestId } : {}),
        })
        break
      }

      const state = normalizeGithubState(message.state)
      const issues = await listGithubIssues(repo, secureCwd, state)
      reply({
        type: 'github_issues_result',
        data: issues,
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'github_prs': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const repo = await resolveRepoRef(secureCwd)
      if (!repo) {
        reply({
          type: 'github_prs_result',
          data: [],
          ...(requestId ? { requestId } : {}),
        })
        break
      }

      const state = normalizeGithubState(message.state)
      const prs = await listGithubPrs(repo, secureCwd, state)
      reply({
        type: 'github_prs_result',
        data: prs,
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'github_pr_diff': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const prNumber = Number(message.prNumber)
      if (!Number.isInteger(prNumber) || prNumber <= 0) {
        errorReply(reply, 'Invalid PR number', requestId)
        break
      }

      const repo = await resolveRepoRef(secureCwd)
      if (!repo) {
        errorReply(reply, 'GitHub remote not found', requestId)
        break
      }

      const diff = await getGithubPrDiff(repo, secureCwd, prNumber)
      reply({
        type: 'github_pr_diff_result',
        data: diff,
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'github_pr_comments': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const prNumber = Number(message.prNumber)
      if (!Number.isInteger(prNumber) || prNumber <= 0) {
        errorReply(reply, 'Invalid PR number', requestId)
        break
      }

      const repo = await resolveRepoRef(secureCwd)
      if (!repo) {
        reply({
          type: 'github_pr_comments_result',
          data: [],
          ...(requestId ? { requestId } : {}),
        })
        break
      }

      const comments = await listGithubPrComments(repo, secureCwd, prNumber)
      reply({
        type: 'github_pr_comments_result',
        data: comments,
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    default:
      return false
  }

  return true
}
