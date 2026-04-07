import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Provider for listing subagent IDs in a Claude Code session.
final ccSubagentIdsProvider = FutureProvider.family<List<String>, String>((
  ref,
  sessionId,
) async {
  final bridge = ref.watch(bridgeServiceProvider);
  return bridge.ccListSubagents(sessionId: sessionId);
});

/// Provider for subagent conversation messages.
///
/// Uses a Dart record as the family key to pass both sessionId and agentId.
final ccSubagentMessagesProvider =
    FutureProvider.family<
      List<Map<String, dynamic>>,
      ({String sessionId, String agentId})
    >((ref, params) async {
      final bridge = ref.watch(bridgeServiceProvider);
      return bridge.ccGetSubagentMessages(
        sessionId: params.sessionId,
        agentId: params.agentId,
      );
    });
