part of '../bridge_service.dart';

/// Pi subagent invocation browsing.
///
/// Pi tool subagents (Task, oracle, finder, librarian, code_review, look_at,
/// and any user-configured extension tool) do NOT have their own session
/// files. Their entire conversation is embedded as a toolCall + toolResult
/// pair in the parent session's JSONL. This endpoint re-reads the parent
/// JSONL and returns the full, untruncated invocation data so the detail
/// view can render the prompt + all content blocks.
extension BridgeServicePiSubagent on BridgeService {
  /// Fetch a single Pi subagent invocation by its location in the parent
  /// session's JSONL: (`parentSessionPath`, `toolCallId`).
  ///
  /// Returns `null` if the invocation can't be found (session file missing
  /// or toolCallId no longer present).
  ///
  /// Uses a 30 second timeout instead of the 10 second default because
  /// reading a large parent JSONL over a relay or other low-bandwidth link can
  /// take longer than a normal RPC round-trip.
  Future<PiSubagentInvocation?> piGetSubagentInvocation({
    required String parentSessionPath,
    required String toolCallId,
  }) {
    final dedupeKey =
        'pi_get_subagent_invocation:$parentSessionPath:$toolCallId';
    return _deduplicatedRequest(
      dedupeKey,
      () => _piGetSubagentInvocationInternal(
        parentSessionPath: parentSessionPath,
        toolCallId: toolCallId,
      ),
    );
  }

  Future<PiSubagentInvocation?> _piGetSubagentInvocationInternal({
    required String parentSessionPath,
    required String toolCallId,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_get_subagent_invocation',
      'parentSessionPath': parentSessionPath,
      'toolCallId': toolCallId,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'pi_subagent_invocation',
      requestId: requestId,
      timeoutSeconds: 30,
    );
    final data = response['data'];
    if (data == null) return null;
    if (data is! Map) return null;
    return PiSubagentInvocation.fromJson(Map<String, dynamic>.from(data));
  }
}
