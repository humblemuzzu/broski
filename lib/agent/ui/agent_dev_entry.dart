import 'package:broski/agent/ui/home/agent_home_screen.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Built with `--dart-define=BROSKI_AGENT_CORE=true`: the entry in a release
/// build too, for testing on a device without a debugger attached.
const bool agentCoreEntryInRelease = bool.fromEnvironment('BROSKI_AGENT_CORE');

/// The hidden way in to the contract core's screens while Phase 4 moves the
/// backends onto them: a long press on [child], in debug builds, or in any
/// build made with [agentCoreEntryInRelease]. Otherwise [child] and nothing
/// else.
class AgentCoreEntry extends StatelessWidget {
  const AgentCoreEntry({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (!kDebugMode && !agentCoreEntryInRelease) return child;
    return GestureDetector(
      key: const ValueKey('agent-core-entry'),
      onLongPress: () => Navigator.of(
        context,
      ).push(MaterialPageRoute<void>(builder: (_) => const AgentHomeScreen())),
      child: child,
    );
  }
}
