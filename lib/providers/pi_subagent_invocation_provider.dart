import 'package:broski/models/pi_subagent_invocation.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Key for fetching a single Pi subagent invocation.
/// Combines the parent session path with the tool call ID — both are
/// required because Pi subagents live embedded in the parent JSONL.
class PiSubagentInvocationKey {
  final String parentSessionPath;
  final String toolCallId;

  const PiSubagentInvocationKey({
    required this.parentSessionPath,
    required this.toolCallId,
  });

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is PiSubagentInvocationKey &&
          other.parentSessionPath == parentSessionPath &&
          other.toolCallId == toolCallId);

  @override
  int get hashCode => Object.hash(parentSessionPath, toolCallId);
}

/// Fetches a full Pi subagent invocation (prompt + untruncated content blocks)
/// from the parent session's JSONL. Used by the subagent detail sheet and
/// the read-only full-screen view.
final piSubagentInvocationProvider =
    FutureProvider.family<PiSubagentInvocation?, PiSubagentInvocationKey>((
      ref,
      key,
    ) async {
      final bridge = ref.watch(bridgeServiceProvider);
      return bridge.piGetSubagentInvocation(
        parentSessionPath: key.parentSessionPath,
        toolCallId: key.toolCallId,
      );
    });
