part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

extension _RuntimePiExtensions on ChatSessionNotifier {
  bool _handleRuntimePiCommonMessage(PiStreamMessage message) {
    switch (message.type) {
      case 'agent-start':
      case 'agent-end':
      case 'text-delta':
      case 'thinking-delta':
      case 'tool-exec-start':
      case 'tool-exec-update':
      case 'tool-exec-end':
      case 'tool-call-start':
      case 'tool-call-args-done':
      case 'message-done':
      case 'error':
        return true;
      case 'message-start':
      case 'message-end':
      case 'turn-start':
      case 'turn-end':
      case 'compaction-start':
      case 'compaction-end':
      case 'retry-start':
      case 'retry-end':
      case 'extension-ui-request':
        return false;
    }
    return false;
  }
}
