part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

extension _RuntimeOpenCodeExtensions on ChatSessionNotifier {
  bool _skipNativeOpenCodeCommonEvent(Map<String, dynamic> payload) {
    final type = payload['type'] as String? ?? '';
    if (type == 'session.status' ||
        type == 'session.idle' ||
        type == 'session.error') {
      return true;
    }

    if (type == 'message.part.delta') {
      final properties =
          payload['properties'] as Map<String, dynamic>? ?? const {};
      return properties['field'] == 'text';
    }

    if (type != 'message.part.updated') return false;
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final part = properties['part'] as Map<String, dynamic>? ?? const {};
    final partType = part['type'] as String? ?? '';
    if (partType == 'tool' || partType == 'reasoning') {
      return true;
    }

    if (partType != 'text') return false;
    final messageId =
        part['messageID'] as String? ??
        part['messageId'] as String? ??
        part['message_id'] as String? ??
        '';
    if (messageId.isEmpty) return true;
    final knownRole =
        _rolesByMessageId[messageId] ?? _messages[messageId]?.role;
    return knownRole != MessageRole.user;
  }
}
