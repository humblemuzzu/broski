import 'package:broski/models/agent_type.dart';
import 'package:broski/models/command.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The durable backend's slash commands are its skills: no OpenCode command
/// list, no agents. Pure so the mapping can be asserted without a bridge.
List<SlashCommand> piDurableCommandsFromSkills(
  List<Map<String, dynamic>> skills,
) {
  final commands = <SlashCommand>[];
  for (final skill in skills) {
    final name = (skill['name'] as String?)?.trim() ?? '';
    if (name.isEmpty) continue;
    commands.add(
      SlashCommand(
        name: name,
        description: skill['description'] as String?,
        source: CommandSource.skill,
        builtin: false,
      ),
    );
  }
  return commands;
}

/// Loads the durable backend's skills through the unified skills message
/// (`unified_list_skills` with `backend: "pi-durable"`).
Future<List<SlashCommand>> loadPiDurableCommands({
  required WidgetRef ref,
  required String? cwd,
}) async {
  if (ref.read(connectionProvider).isOfflineMode) return const [];
  try {
    final skills = await ref
        .read(bridgeServiceProvider)
        .unifiedListSkills(backend: AgentType.piDurable, cwd: cwd);
    return piDurableCommandsFromSkills(skills);
  } catch (_) {
    return const [];
  }
}
