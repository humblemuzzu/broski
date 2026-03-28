import 'package:broski/models/agent.dart';
import 'package:broski/models/command.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Result from loading commands and agents.
class CommandsAndAgents {
  final List<SlashCommand> commands;
  final List<Agent> agents;
  const CommandsAndAgents({required this.commands, required this.agents});
}

/// Loads commands for Claude Code mode (built-in + custom from .claude/commands/).
///
/// Extracted from `_ChatScreenState._loadClaudeCodeCommands` in `chat_screen.dart`.
Future<List<SlashCommand>> loadClaudeCodeCommands({
  required WidgetRef ref,
  required String? cwd,
}) async {
  final bridge = ref.read(bridgeServiceProvider);
  try {
    // Fetch custom commands from .claude/commands/ directories
    final ccCommands = await bridge.ccListCommands(cwd: cwd);
    // Built-in slash commands (from Claude Code init payload when available).
    // Fallback to a small default list when init is not available.
    const builtInDescriptions = <String, String>{
      'compact': 'Summarize conversation to free context',
      'clear': 'Clear conversation and start fresh',
      'help': 'Show available commands',
    };
    final initSlash =
        ref.read(chatSessionProvider).ccInit?.slashCommands ?? const <String>[];
    final builtInNames = initSlash.isNotEmpty
        ? initSlash
              .map((s) => s.toString().trim())
              .where((s) => s.startsWith('/'))
              .map((s) => s.replaceFirst('/', ''))
              .where((s) => s.isNotEmpty)
              .toSet()
              .toList()
        : const ['compact', 'clear', 'help'];
    final builtInCommands = builtInNames
        .map(
          (name) => SlashCommand(
            name: name,
            description: builtInDescriptions[name] ?? 'Claude Code command',
            builtin: true,
          ),
        )
        .toList();
    // Convert CC commands to SlashCommand and merge
    final customCommands = ccCommands
        .map((c) => c.toSlashCommand(builtin: false))
        .toList();
    return [...builtInCommands, ...customCommands];
  } catch (_) {
    // Use just built-in commands if loading fails
    return const [
      SlashCommand(
        name: 'compact',
        description: 'Summarize conversation to free context',
        builtin: true,
      ),
      SlashCommand(
        name: 'clear',
        description: 'Clear conversation and start fresh',
        builtin: true,
      ),
      SlashCommand(
        name: 'help',
        description: 'Show available commands',
        builtin: true,
      ),
    ];
  }
}

/// Codex built-in commands (full parity with Codex CLI).
const kCodexBuiltinCommands = <SlashCommand>[
  SlashCommand(name: 'model', description: 'Change model', builtin: true),
  SlashCommand(
    name: 'approvals',
    description: 'Set approval policy (untrusted/on-failure/on-request/never)',
    builtin: true,
  ),
  SlashCommand(
    name: 'status',
    description: 'Open sidebar with context usage, tokens & session info',
    builtin: true,
  ),
  SlashCommand(
    name: 'reasoning',
    description: 'Set reasoning effort (minimal/low/medium/high/xhigh)',
    builtin: true,
  ),
  SlashCommand(
    name: 'reasoningsummary',
    description: 'Set reasoning summary (auto/concise/detailed/none)',
    builtin: true,
  ),
  SlashCommand(
    name: 'websearch',
    description: 'Toggle web search (on/off)',
    builtin: true,
  ),
  SlashCommand(
    name: 'skills',
    description: 'Toggle skills discovery (on/off)',
    builtin: true,
  ),
  SlashCommand(
    name: 'compact',
    description: 'Summarize/compact thread context',
    builtin: true,
  ),
  SlashCommand(
    name: 'diff',
    description: 'Show file changes diff',
    builtin: true,
  ),
  SlashCommand(
    name: 'undo',
    description: 'Undo last file changes',
    builtin: true,
  ),
  SlashCommand(
    name: 'review',
    description: 'Start code review of uncommitted changes',
    builtin: true,
  ),
  SlashCommand(
    name: 'agents',
    description: 'Edit AGENTS.md project instructions',
    builtin: true,
  ),
  SlashCommand(
    name: 'init',
    description: 'Create AGENTS.md with template',
    builtin: true,
  ),
  SlashCommand(
    name: 'mcp',
    description: 'List MCP server status',
    builtin: true,
  ),
];

/// OpenCode built-in commands (matching TUI).
const kOpenCodeBuiltinCommands = <SlashCommand>[
  SlashCommand(name: 'undo', description: 'Undo last message', builtin: true),
  SlashCommand(name: 'redo', description: 'Redo last message', builtin: true),
  SlashCommand(name: 'compact', description: 'Compact session', builtin: true),
  SlashCommand(
    name: 'summarize',
    description: 'Compact session (alias)',
    builtin: true,
  ),
  SlashCommand(name: 'unshare', description: 'Unshare session', builtin: true),
  SlashCommand(name: 'rename', description: 'Rename session', builtin: true),
  SlashCommand(
    name: 'copy',
    description: 'Copy transcript to clipboard',
    builtin: true,
  ),
  SlashCommand(
    name: 'export',
    description: 'Export transcript to file',
    builtin: true,
  ),
  SlashCommand(name: 'timeline', description: 'Jump to message', builtin: true),
  SlashCommand(name: 'fork', description: 'Fork session', builtin: true),
  SlashCommand(
    name: 'thinking',
    description: 'Toggle thinking visibility',
    builtin: true,
  ),
  SlashCommand(name: 'share', description: 'Share session', builtin: true),
  SlashCommand(name: 'new', description: 'Create new session', builtin: true),
  SlashCommand(
    name: 'clear',
    description: 'Create new session (alias)',
    builtin: true,
  ),
  SlashCommand(name: 'models', description: 'List models', builtin: true),
  SlashCommand(name: 'agents', description: 'List agents', builtin: true),
  SlashCommand(name: 'session', description: 'List sessions', builtin: true),
  SlashCommand(
    name: 'resume',
    description: 'List sessions (alias)',
    builtin: true,
  ),
  SlashCommand(
    name: 'continue',
    description: 'List sessions (alias)',
    builtin: true,
  ),
  SlashCommand(
    name: 'help',
    description: 'Show available commands',
    builtin: true,
  ),
];

/// Loads commands for Pi mode.
///
/// Extracted from the Pi branch of `_ChatScreenState._loadCommandsAndAgents`.
Future<List<SlashCommand>> loadPiCommands({
  required WidgetRef ref,
  required String? cwd,
}) async {
  final connection = ref.read(connectionProvider);
  if (connection.isOfflineMode) return const [];
  try {
    final piBridge = ref.read(piBridgeServiceProvider);
    final piCommands = await piBridge.listCommands(projectPath: cwd);
    return piCommands
        .map(
          (c) => SlashCommand(
            name: c.name,
            description: c.description ?? c.source,
            builtin: false,
          ),
        )
        .toList();
  } catch (_) {
    return const [];
  }
}

/// Loads commands and agents for OpenCode mode.
///
/// Extracted from the OpenCode branch of `_ChatScreenState._loadCommandsAndAgents`.
///
/// Also calls `_loadOpenCodeVariants()` on success — the caller should invoke
/// the [onLoadVariants] callback when the returned data is non-empty.
Future<CommandsAndAgents> loadOpenCodeCommandsAndAgents({
  required WidgetRef ref,
  required String projectPath,
}) async {
  final bridge = ref.read(bridgeServiceProvider);
  final storage = ref.read(storageServiceProvider);
  final connection = ref.read(connectionProvider);

  // Offline mode
  if (connection.isOfflineMode) {
    final cachedCommands = await storage.getCachedCommands();
    final cachedAgents = await storage.getCachedAgents();
    return CommandsAndAgents(
      commands: cachedCommands.isNotEmpty ? cachedCommands : [],
      agents: cachedAgents.isNotEmpty ? cachedAgents : kDefaultAgents,
    );
  }

  try {
    final commands = await bridge.listCommands(projectPath: projectPath);
    final agents = await bridge.listAgents(projectPath: projectPath);
    // Cache for offline use
    if (commands.isNotEmpty) await storage.cacheCommands(commands);
    if (agents.isNotEmpty) await storage.cacheAgents(agents);
    return CommandsAndAgents(
      commands: [...kOpenCodeBuiltinCommands, ...commands],
      agents: agents.isNotEmpty ? agents : kDefaultAgents,
    );
  } catch (_) {
    return const CommandsAndAgents(commands: [], agents: kDefaultAgents);
  }
}
