import type { ClientMessage, ServerMessage } from '../types'

type Reply = (message: ServerMessage) => void

type OpenCodeFilesLike = {
  readFile: (path: string, dir: string) => Promise<any>
  findFiles: (query: string, dir?: string) => Promise<string[]>
  findText: (pattern: string, include?: string, dir?: string) => Promise<any[]>
  findSymbols: (query: string, dir?: string) => Promise<any[]>
  searchFilesAndDirs: (query: string, dir?: string) => Promise<string[]>
  getFileStatus: (dir?: string) => Promise<any[]>
}

type OcFilesCtx = {
  requireOpenCode: () => OpenCodeFilesLike
  readFileDirectly: (path: string) => Promise<any>
  readFileBinaryDirectly: (path: string, maxSizeMb: number) => Promise<any>
  listFilesDirectly: (path: string) => Promise<any[]>
  fileSearch: {
    searchFilesAndDirs: (opts: { query: string; cwd: string; limit: number; includeDirs: boolean }) => Promise<string[]>
  }
}

export async function handle(
  message: ClientMessage & { requestId?: string },
  reply: Reply,
  ctx: OcFilesCtx,
): Promise<boolean> {
  switch (message.type) {
    case 'read_file': {
      const content = message.projectPath
        ? await ctx.requireOpenCode().readFile(message.path, message.projectPath)
        : await ctx.readFileDirectly(message.path)
      reply({ type: 'file_content', data: content, path: message.path })
      return true
    }
    case 'read_file_binary': {
      const maxSizeMb = message.maxSizeMb ?? 10
      const result = await ctx.readFileBinaryDirectly(message.path, maxSizeMb)
      if ('error' in result) {
        if (result.error === 'too_large') {
          reply({
            type: 'file_too_large',
            data: { path: message.path, size: result.size ?? 0, maxSize: maxSizeMb * 1024 * 1024 },
          })
        } else if (result.error === 'access_denied') {
          reply({ type: 'error', message: 'Access denied' })
        } else {
          reply({ type: 'error', message: 'File not found' })
        }
      } else {
        reply({ type: 'file_binary', data: result, path: message.path })
      }
      return true
    }
    case 'browse': {
      const items = await ctx.listFilesDirectly(message.path)
      reply({ type: 'browse_result', data: { path: message.path, items } })
      return true
    }
    case 'find_files': {
      const oc = ctx.requireOpenCode()
      const files = await oc.findFiles(message.query, message.projectPath)
      reply({ type: 'files_found', data: files })
      return true
    }
    case 'find_text': {
      const oc = ctx.requireOpenCode()
      const results = await oc.findText(message.pattern, message.include, message.projectPath)
      reply({ type: 'text_found', data: results })
      return true
    }
    case 'find_symbols': {
      const oc = ctx.requireOpenCode()
      const symbols = await oc.findSymbols(message.query, message.projectPath)
      reply({ type: 'symbols_found', data: symbols })
      return true
    }
    case 'search_files_and_dirs': {
      const cwd = message.projectPath
      if (cwd) {
        const results = await ctx.fileSearch.searchFilesAndDirs({
          query: message.query ?? '',
          cwd,
          limit: 50,
          includeDirs: true,
        })
        reply({ type: 'files_and_dirs_found', data: results })
      } else {
        const oc = ctx.requireOpenCode()
        const results = await oc.searchFilesAndDirs(message.query, message.projectPath)
        reply({ type: 'files_and_dirs_found', data: results })
      }
      return true
    }
    case 'get_file_status': {
      const oc = ctx.requireOpenCode()
      const fileStatus = await oc.getFileStatus(message.projectPath)
      reply({ type: 'file_status', data: fileStatus })
      return true
    }
    default:
      return false
  }
}
