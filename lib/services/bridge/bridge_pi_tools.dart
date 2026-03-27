import 'dart:async';

import '../../models/pi.dart';
import '../pi_bridge_service.dart';

/// Pi tool management, model capabilities, granular abort, and queue
/// methods. Extension on PiBridgeService — keeps the base service lean.
extension PiBridgeTools on PiBridgeService {
  // ── Tool Management ──────────────────────────────────────────────

  /// Get all tools with their active/inactive status.
  Future<List<PiTool>> getTools({String? projectPath}) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_get_tools',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await waitForResponse('pi_tools', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? const [];
    return data
        .whereType<Map<String, dynamic>>()
        .map((entry) => PiTool.fromJson(entry))
        .toList();
  }

  /// Get names of currently active tools.
  Future<List<String>> getActiveToolNames({String? projectPath}) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_get_active_tools',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await waitForResponse(
      'pi_active_tools',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? const [];
    return data.whereType<String>().toList();
  }

  /// Set active tools by name. Returns updated list of active tool names.
  Future<List<String>> setActiveTools(
    List<String> toolNames, {
    String? projectPath,
  }) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_set_active_tools',
      'requestId': requestId,
      'toolNames': toolNames,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await waitForResponse(
      'pi_active_tools_set',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? const [];
    return data.whereType<String>().toList();
  }

  // ── Model Capabilities ───────────────────────────────────────────

  /// Get thinking capabilities for the current model.
  Future<PiThinkingCapabilities> getThinkingCapabilities({
    String? projectPath,
  }) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_get_thinking_capabilities',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await waitForResponse(
      'pi_thinking_capabilities',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return PiThinkingCapabilities.fromJson(data);
  }

  /// List ALL models including unauthenticated ones.
  Future<List<PiModel>> listAllModels({String? projectPath}) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_list_all_models',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await waitForResponse(
      'pi_all_models',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? const [];
    return data
        .whereType<Map<String, dynamic>>()
        .map((entry) => PiModel.fromJson(entry))
        .toList();
  }

  /// Refresh model registry (re-scan for API keys).
  /// Returns updated list of available (authenticated) models.
  Future<List<PiModel>> refreshModels({String? projectPath}) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_refresh_models',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await waitForResponse(
      'pi_models_refreshed',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? const [];
    return data
        .whereType<Map<String, dynamic>>()
        .map((entry) => PiModel.fromJson(entry))
        .toList();
  }

  // ── Granular Abort ─────────────────────────────────────────────

  /// Abort in-progress compaction (manual or auto).
  Future<void> abortCompaction({String? projectPath}) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_abort_compaction',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    await waitForResponse('pi_compaction_aborted', requestId: requestId);
  }

  /// Abort in-progress branch summary generation.
  Future<void> abortBranchSummary({String? projectPath}) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_abort_branch_summary',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    await waitForResponse('pi_branch_summary_aborted', requestId: requestId);
  }

  /// Abort running bash command.
  Future<void> abortBash({String? projectPath}) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_abort_bash',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    await waitForResponse('pi_bash_aborted', requestId: requestId);
  }

  // ── Queue Management ───────────────────────────────────────────

  /// Clear all queued steering and follow-up messages.
  /// Returns the messages that were cleared.
  Future<PiQueueState> clearQueue({String? projectPath}) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_clear_queue',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await waitForResponse(
      'pi_queue_cleared',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return PiQueueState.fromJson(data);
  }

  /// Get current queue state (pending steering and follow-up messages).
  Future<PiQueueState> getQueue({String? projectPath}) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_get_queue',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await waitForResponse('pi_queue', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return PiQueueState.fromJson(data);
  }

  // ── Misc ───────────────────────────────────────────────────────

  /// Get the text of the last assistant message.
  Future<String?> getLastAssistantText({String? projectPath}) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_get_last_assistant_text',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await waitForResponse(
      'pi_last_assistant_text',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return data['text'] as String?;
  }

  // ── Bash Execution ─────────────────────────────────────────────

  /// Execute a bash command and inject its output into the agent's context.
  /// Different from PTY — this is a single-shot command the agent can see.
  Future<PiBashResult> executeBash(
    String command, {
    bool excludeFromContext = false,
    String? projectPath,
  }) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_execute_bash',
      'requestId': requestId,
      'command': command,
      if (excludeFromContext) 'excludeFromContext': true,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await waitForResponse(
      'pi_bash_result',
      requestId: requestId,
      timeout: const Duration(minutes: 5),
    );
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return PiBashResult.fromJson(data);
  }

  // ── Label Management ───────────────────────────────────────────

  /// Set or clear a label (bookmark) on a session entry.
  Future<bool> setLabel(
    String entryId, {
    String? label,
    String? projectPath,
  }) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_set_label',
      'requestId': requestId,
      'entryId': entryId,
      if (label != null) 'label': label,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await waitForResponse(
      'pi_label_set',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return data['success'] as bool? ?? false;
  }

  /// Get a single label for a specific entry.
  Future<String?> getLabel(String entryId, {String? projectPath}) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_get_label',
      'requestId': requestId,
      'entryId': entryId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await waitForResponse('pi_label', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return data['label'] as String?;
  }

  /// Get all labels (bookmarks) in the current session.
  Future<List<PiLabel>> getLabels({String? projectPath}) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_get_labels',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await waitForResponse('pi_labels', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? const [];
    return data
        .whereType<Map<String, dynamic>>()
        .map((entry) => PiLabel.fromJson(entry))
        .toList();
  }

  // ── Session Tree ───────────────────────────────────────────────

  /// Get the session tree structure with all entries and their relationships.
  Future<PiSessionTree> getSessionTree({String? projectPath}) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_get_tree',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await waitForResponse('pi_tree', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return PiSessionTree.fromJson(data);
  }

  // ── Custom Messages ────────────────────────────────────────────

  /// Send a custom message to the Pi session (for extension integration).
  Future<bool> sendCustomMessage({
    required String customType,
    String? content,
    bool display = true,
    Map<String, dynamic>? details,
    bool triggerTurn = false,
    String? deliverAs,
    String? projectPath,
  }) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_send_custom_message',
      'requestId': requestId,
      'customType': customType,
      if (content != null) 'content': content,
      'display': display,
      if (details != null) 'details': details,
      if (triggerTurn) 'triggerTurn': true,
      if (deliverAs != null) 'deliverAs': deliverAs,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await waitForResponse(
      'pi_custom_message_sent',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return data['success'] as bool? ?? false;
  }
}
