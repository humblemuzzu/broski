import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../models/message.dart';
import '../../providers/chat_provider.dart';
import 'package:broski/utils/snackbar_helpers.dart';

/// Copy transcript to clipboard as markdown.
/// Extracted from `_ChatScreenState._copyTranscriptToClipboard`.
void copyTranscriptToClipboard({
  required BuildContext context,
  required WidgetRef ref,
  required String sessionTitle,
}) {
  final chatState = ref.read(chatSessionProvider);
  if (chatState.messages.isEmpty) {
    showInfo(context, 'No messages to copy');
    return;
  }
  final buffer = StringBuffer();
  buffer.writeln('# Session: $sessionTitle');
  buffer.writeln('Date: ${DateTime.now().toIso8601String()}');
  buffer.writeln('---\n');
  for (final msg in chatState.messages) {
    final role = msg.role == MessageRole.user ? 'You' : 'Assistant';
    buffer.writeln('## $role');
    buffer.writeln(msg.text);
    buffer.writeln();
  }
  Clipboard.setData(ClipboardData(text: buffer.toString()));
  showInfo(context, 'Transcript copied to clipboard');
}

/// Share transcript via system share sheet.
/// Extracted from `_ChatScreenState._shareTranscript`.
void shareTranscript({required WidgetRef ref, required String sessionTitle}) {
  final chatState = ref.read(chatSessionProvider);
  final buffer = StringBuffer();
  buffer.writeln('# Session: $sessionTitle');
  buffer.writeln('---\n');
  for (final msg in chatState.messages) {
    final role = msg.role == MessageRole.user ? 'You' : 'Assistant';
    buffer.writeln('## $role');
    buffer.writeln(msg.text);
    buffer.writeln();
  }
  Share.share(buffer.toString(), subject: 'Chat Session: $sessionTitle');
}
