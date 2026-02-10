import { ensureGitSuccess, runGit } from './command'
import { parseGitBranches, parseGitLog, parseGitStatus } from './parse'
import {
  clamp,
  isSafeBranchName,
  isSafeHash,
  isSafePathSpec,
  isSafeRef,
  parsePositiveInt,
  sanitizeCommitMessage,
} from './security'
import type { GitHandlerContext, GitReply } from './types'
import { ensureSecureCwd, errorReply } from './util'

export async function handleGitCommand(
  message: any,
  reply: GitReply,
  ctx: GitHandlerContext,
): Promise<boolean> {
  const requestId =
    typeof message?.requestId === 'string' ? message.requestId : undefined

  switch (message.type) {
    case 'git_diff': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const rawPath = ctx.safeString(message.path).trim()
      const staged = message.staged === true

      if (rawPath && !isSafePathSpec(rawPath)) {
        errorReply(reply, 'Invalid path', requestId)
        break
      }

      const args: string[] = ['diff']
      if (staged) args.push('--staged')
      args.push('--')
      if (rawPath) args.push(rawPath)

      const result = await runGit(args, secureCwd)
      const err = ensureGitSuccess(result, 'git diff failed')
      if (err) {
        errorReply(reply, err, requestId)
        break
      }

      reply({
        type: 'git_diff',
        data: { path: rawPath || undefined, diff: result.stdout, staged },
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'git_status': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const result = await runGit(
        ['status', '--porcelain=v2', '--branch', '--untracked-files=all'],
        secureCwd,
      )
      const err = ensureGitSuccess(result, 'git status failed')
      if (err) {
        errorReply(reply, err, requestId)
        break
      }

      reply({
        type: 'git_status_result',
        data: parseGitStatus(result.stdout),
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'git_log': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const limit = clamp(parsePositiveInt(message.limit, 50), 1, 200)
      const result = await runGit(
        ['log', `--format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s%x1e`, '-n', String(limit)],
        secureCwd,
      )
      const err = ensureGitSuccess(result, 'git log failed')
      if (err) {
        errorReply(reply, err, requestId)
        break
      }

      reply({
        type: 'git_log_result',
        data: parseGitLog(result.stdout),
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'git_branches': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const result = await runGit(
        [
          'branch',
          '-a',
          '--format=%(refname)|%(refname:short)|%(upstream:short)|%(upstream:track)|%(HEAD)',
        ],
        secureCwd,
      )
      const err = ensureGitSuccess(result, 'git branch failed')
      if (err) {
        errorReply(reply, err, requestId)
        break
      }

      reply({
        type: 'git_branches_result',
        data: parseGitBranches(result.stdout),
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'git_stage': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const path = ctx.safeString(message.path).trim()
      if (path && !isSafePathSpec(path)) {
        errorReply(reply, 'Invalid path', requestId)
        break
      }

      const args = path ? ['add', '--', path] : ['add', '-A']
      const result = await runGit(args, secureCwd)
      const err = ensureGitSuccess(result, 'git add failed')
      if (err) {
        errorReply(reply, err, requestId)
        break
      }

      reply({
        type: 'git_staged',
        data: { ok: true },
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'git_unstage': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const path = ctx.safeString(message.path).trim()
      if (path && !isSafePathSpec(path)) {
        errorReply(reply, 'Invalid path', requestId)
        break
      }

      const args = path
        ? ['restore', '--staged', '--', path]
        : ['reset', 'HEAD']
      const result = await runGit(args, secureCwd)
      const err = ensureGitSuccess(result, 'git unstage failed')
      if (err) {
        errorReply(reply, err, requestId)
        break
      }

      reply({
        type: 'git_unstaged',
        data: { ok: true },
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'git_revert_file': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const path = ctx.safeString(message.path).trim()
      if (!path || !isSafePathSpec(path)) {
        errorReply(reply, 'Invalid path', requestId)
        break
      }

      const result = await runGit(
        ['restore', '--worktree', '--', path],
        secureCwd,
      )
      const err = ensureGitSuccess(result, 'git restore failed')
      if (err) {
        errorReply(reply, err, requestId)
        break
      }

      reply({
        type: 'git_reverted',
        data: { ok: true },
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'git_commit': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const rawMessage = sanitizeCommitMessage(ctx.safeString(message.message))
      if (!rawMessage.trim()) {
        errorReply(reply, 'Commit message cannot be empty', requestId)
        break
      }

      const result = await runGit(['commit', '-m', rawMessage], secureCwd)
      const err = ensureGitSuccess(result, 'git commit failed')
      if (err) {
        errorReply(reply, err, requestId)
        break
      }

      const latest = await runGit(['log', '-1', '--format=%H%x1f%s'], secureCwd)
      const latestErr = ensureGitSuccess(latest, 'Failed to read latest commit')
      if (latestErr) {
        errorReply(reply, latestErr, requestId)
        break
      }

      const [hash = '', subject = ''] = latest.stdout.trim().split('\x1f')
      reply({
        type: 'git_committed',
        data: { hash, subject },
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'git_push': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const force = message.force === true
      const args = force ? ['push', '--force-with-lease'] : ['push']
      const result = await runGit(args, secureCwd)
      const err = ensureGitSuccess(result, 'git push failed')
      if (err) {
        errorReply(reply, err, requestId)
        break
      }

      reply({
        type: 'git_pushed',
        data: { ok: true },
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'git_pull': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const rebase = message.rebase !== false
      const args = rebase ? ['pull', '--rebase'] : ['pull', '--no-rebase']
      const result = await runGit(args, secureCwd)
      const err = ensureGitSuccess(result, 'git pull failed')
      if (err) {
        errorReply(reply, err, requestId)
        break
      }

      reply({
        type: 'git_pulled',
        data: { ok: true },
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'git_fetch': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const result = await runGit(['fetch', '--all', '--prune'], secureCwd)
      const err = ensureGitSuccess(result, 'git fetch failed')
      if (err) {
        errorReply(reply, err, requestId)
        break
      }

      reply({
        type: 'git_fetched',
        data: { ok: true },
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'git_checkout': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const branch = ctx.safeString(message.branch).trim()
      if (!isSafeBranchName(branch)) {
        errorReply(reply, 'Invalid branch name', requestId)
        break
      }

      const result = await runGit(['switch', branch], secureCwd)
      const err = ensureGitSuccess(result, 'git switch failed')
      if (err) {
        errorReply(reply, err, requestId)
        break
      }

      reply({
        type: 'git_checked_out',
        data: { branch },
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'git_create_branch': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const name = ctx.safeString(message.name).trim()
      const startPoint = ctx.safeString(message.startPoint).trim()
      if (!isSafeBranchName(name)) {
        errorReply(reply, 'Invalid branch name', requestId)
        break
      }
      if (startPoint && !isSafeRef(startPoint)) {
        errorReply(reply, 'Invalid start point', requestId)
        break
      }

      const args = ['switch', '-c', name]
      if (startPoint) args.push(startPoint)
      const result = await runGit(args, secureCwd)
      const err = ensureGitSuccess(result, 'git branch create failed')
      if (err) {
        errorReply(reply, err, requestId)
        break
      }

      reply({
        type: 'git_branch_created',
        data: { name },
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'git_stash': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const result = await runGit(['stash', 'push', '-u'], secureCwd)
      const err = ensureGitSuccess(result, 'git stash failed')
      if (err) {
        errorReply(reply, err, requestId)
        break
      }

      reply({
        type: 'git_stashed',
        data: { ok: true },
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'git_stash_pop': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const result = await runGit(['stash', 'pop'], secureCwd)
      const err = ensureGitSuccess(result, 'git stash pop failed')
      if (err) {
        errorReply(reply, err, requestId)
        break
      }

      reply({
        type: 'git_stash_popped',
        data: { ok: true },
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    case 'git_commit_diff': {
      const secureCwd = await ensureSecureCwd(message, ctx)
      if (!secureCwd) {
        errorReply(reply, 'Access denied', requestId)
        break
      }

      const hash = ctx.safeString(message.hash).trim().toLowerCase()
      if (!isSafeHash(hash)) {
        errorReply(reply, 'Invalid commit hash', requestId)
        break
      }

      const result = await runGit(
        ['show', hash, '--format=', '--patch'],
        secureCwd,
      )
      const err = ensureGitSuccess(result, 'git show failed')
      if (err) {
        errorReply(reply, err, requestId)
        break
      }

      reply({
        type: 'git_commit_diff_result',
        data: result.stdout,
        ...(requestId ? { requestId } : {}),
      })
      break
    }

    default:
      return false
  }

  return true
}
