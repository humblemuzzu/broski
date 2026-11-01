import 'package:broski/models/command.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
