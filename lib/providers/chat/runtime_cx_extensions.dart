part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

extension _RuntimeCodexExtensions on ChatSessionNotifier {
  bool _handleRuntimeCodexCommonMessage(CodexStreamMessage message) {
    if (message is CodexErrorMessage) {
      return true;
    }

    if (message is! CodexNotificationMessage) {
      return false;
    }

    final method = message.method;
    final params = message.params;

    if (method == 'item/completed') {
      final item = params['item'];
      if (item is Map<String, dynamic>) {
        _appendCodexRuntimeSessionDiffs(item);
      }
    }

    switch (method) {
      case 'turn/started':
      case 'turn/completed':
      case 'turn/failed':
      case 'error':
      case 'item/agentMessage/delta':
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
      case 'item/started':
      case 'item/completed':
      case 'item/commandExecution/outputDelta':
      case 'rawResponseItem/completed':
        return true;
      default:
        return false;
    }
  }

  void _appendCodexRuntimeSessionDiffs(Map<String, dynamic> item) {
    if (item['type'] != 'fileChange') return;
    final changes = item['changes'];
    if (changes is! List) return;

    final nextDiffs = <DiffEntry>[...state.sessionDiffs];
    final itemId = item['id']?.toString();
    var changed = false;
    for (final entry in changes) {
      if (entry is! Map<String, dynamic>) continue;
      final file = entry['path']?.toString() ?? '';
      final diff = entry['diff']?.toString() ?? '';
      if (file.isEmpty || diff.trim().isEmpty) continue;
      final (adds, dels) = _countUnifiedDiffAddsDels(diff);
      if (itemId != null && itemId.isNotEmpty) {
        nextDiffs.removeWhere((existing) => existing.partId == itemId);
      }
      nextDiffs.add(
        DiffEntry(
          file: file,
          before: '',
          after: '',
          additions: adds,
          deletions: dels,
          diff: diff,
          partId: itemId,
        ),
      );
      changed = true;
    }

    if (changed) {
      state = state.copyWith(sessionDiffs: nextDiffs);
    }
  }
}
